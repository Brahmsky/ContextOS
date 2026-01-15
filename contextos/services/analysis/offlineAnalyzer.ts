import { readStore } from "../../data-layer/src/jsonStore.js";
import { hashJson } from "../../packages/utils/src/hash.js";
import type { StrategyKey, StrategyMetrics, StrategyMetricsSummary } from "../../packages/shared-types/src/strategyMetrics.js";
import type { RecommendationReport, RecommendationScope } from "../../packages/shared-types/src/recommendations.js";
import type { InvariantSeverity } from "../../packages/shared-types/src/invariants.js";
import type { Recipe, ContextPlan } from "../../packages/shared-types/src/types.js";

const severityList: InvariantSeverity[] = ["info", "warn", "fatal"];

const emptyRates = (): Record<InvariantSeverity, number> => ({ info: 0, warn: 0, fatal: 0 });

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function buildStrategyKey(recipe: Recipe): StrategyKey {
  const policySignature = hashJson({
    viewWeights: recipe.viewWeights,
    runtimePolicy: recipe.runtimePolicy
  });
  return {
    viewId: recipe.viewId,
    plannerVariant: recipe.plannerVersion,
    policySignature
  };
}

function summarizeMetrics(metrics: StrategyMetrics): StrategyMetricsSummary {
  return {
    strategyKey: metrics.strategyKey,
    stabilityScore: metrics.stabilityScore,
    avgDriftMagnitude: metrics.avgDriftMagnitude,
    invariantViolationRate: metrics.invariantViolationRate,
    regressionFailRate: metrics.regressionFailRate,
    avgTokenUtilization: metrics.avgTokenUtilization
  };
}

export class OfflineAnalyzer {
  constructor(private readonly rootDir: string) {}

  async computeStrategyMetrics(): Promise<StrategyMetrics[]> {
    const recipes = (await readStore(this.rootDir, "recipes")) as Recipe[];
    const plans = (await readStore(this.rootDir, "context_plans")) as ContextPlan[];
    const driftReports = (await readStore(this.rootDir, "drift_reports")) as Array<{
      currentRecipeId: string;
      driftSignals: Array<{ magnitude: number }>;
    }>;
    const invariantReports = (await readStore(this.rootDir, "invariant_reports")) as Array<{
      recipeId: string;
      violations: Array<{ severity: InvariantSeverity }>;
    }>;
    const regressionReports = (await readStore(this.rootDir, "regression_reports")) as Array<{
      candidateRecipeId: string;
      pass: boolean;
    }>;

    const planById = new Map(plans.map((plan) => [plan.planId, plan]));
    const invariantByRecipe = new Map(invariantReports.map((report) => [report.recipeId, report]));
    const driftByRecipe = new Map(driftReports.map((report) => [report.currentRecipeId, report]));
    const regressionByRecipe = new Map(regressionReports.map((report) => [report.candidateRecipeId, report]));

    const metricsByKey = new Map<string, StrategyMetrics>();

    for (const recipe of recipes) {
      const plan = planById.get(recipe.contextPlanId);
      if (!plan) {
        continue;
      }
      const key = buildStrategyKey(recipe);
      const keyId = `${key.viewId}:${key.plannerVariant}:${key.policySignature}`;
      const existing = metricsByKey.get(keyId) ?? {
        strategyKey: key,
        totalRuns: 0,
        invariantViolationRate: emptyRates(),
        avgDriftMagnitude: 0,
        regressionFailRate: 0,
        avgTokenUtilization: 0,
        stabilityScore: 0
      };

      existing.totalRuns += 1;

      const tokenUtilization = plan.tokenReport.budgetTotal
        ? plan.tokenReport.usedTotal / plan.tokenReport.budgetTotal
        : 0;
      existing.avgTokenUtilization += tokenUtilization;

      const drift = driftByRecipe.get(recipe.id);
      const driftMagnitude = drift && drift.driftSignals.length
        ? drift.driftSignals.reduce((sum, signal) => sum + signal.magnitude, 0) / drift.driftSignals.length
        : 0;
      existing.avgDriftMagnitude += driftMagnitude;

      const invariant = invariantByRecipe.get(recipe.id);
      if (invariant) {
        const counts = emptyRates();
        invariant.violations.forEach((violation) => {
          counts[violation.severity] += 1;
        });
        severityList.forEach((severity) => {
          existing.invariantViolationRate[severity] += counts[severity];
        });
      }

      const regression = regressionByRecipe.get(recipe.id);
      if (regression && !regression.pass) {
        existing.regressionFailRate += 1;
      }

      metricsByKey.set(keyId, existing);
    }

    return [...metricsByKey.values()].map((metrics) => {
      const runs = metrics.totalRuns || 1;
      const avgUtil = metrics.avgTokenUtilization / runs;
      const avgDrift = metrics.avgDriftMagnitude / runs;
      const invariantRates: Record<InvariantSeverity, number> = emptyRates();
      severityList.forEach((severity) => {
        invariantRates[severity] = metrics.invariantViolationRate[severity] / runs;
      });
      const regressionFailRate = metrics.regressionFailRate / runs;
      const stabilityScore = clamp(
        1 -
          invariantRates.fatal * 1 -
          invariantRates.warn * 0.5 -
          avgDrift * 0.5 -
          regressionFailRate * 1 -
          Math.max(0, avgUtil - 0.9)
      );

      return {
        ...metrics,
        invariantViolationRate: invariantRates,
        avgDriftMagnitude: avgDrift,
        regressionFailRate,
        avgTokenUtilization: avgUtil,
        stabilityScore
      };
    });
  }

  async recommend(params: {
    scope: RecommendationScope;
    viewId?: string;
    limit?: number;
  }): Promise<RecommendationReport> {
    const metrics = await this.computeStrategyMetrics();
    const filtered = params.scope === "view" && params.viewId
      ? metrics.filter((entry) => entry.strategyKey.viewId === params.viewId)
      : metrics;

    const sorted = [...filtered].sort((a, b) => b.stabilityScore - a.stabilityScore);
    const limit = params.limit ?? 3;
    const recommended = sorted.slice(0, limit).map(summarizeMetrics);
    const rejected = [...sorted]
      .reverse()
      .slice(0, limit)
      .map(summarizeMetrics);

    const rationale = [...recommended, ...rejected].map((entry) => {
      const rules: string[] = [];
      if (entry.stabilityScore > 0.8) {
        rules.push("high_stability_score");
      }
      if (entry.invariantViolationRate.fatal > 0) {
        rules.push("fatal_invariant_rate_nonzero");
      }
      if (entry.avgDriftMagnitude > 0.4) {
        rules.push("high_drift_magnitude");
      }
      if (entry.regressionFailRate > 0) {
        rules.push("regression_fail_rate_nonzero");
      }
      return { strategyKey: entry.strategyKey, rules };
    });

    const confidence = filtered.length
      ? clamp(recommended.reduce((sum, entry) => sum + entry.stabilityScore, 0) / recommended.length)
      : 0;

    return {
      scope: params.scope,
      recommendedStrategies: recommended,
      rejectedStrategies: rejected,
      rationale,
      confidence
    };
  }
}
