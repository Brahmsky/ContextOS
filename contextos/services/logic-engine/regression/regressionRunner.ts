import type { ContextPlan, Recipe, ViewDefinition } from "../../../packages/shared-types/src/types.js";
import type { DriftReport } from "../../../packages/shared-types/src/drift.js";
import type { RegressionProfile, RegressionReport } from "../../../packages/shared-types/src/regression.js";
import type { InvariantReport } from "../../../packages/shared-types/src/invariants.js";
import { diffRecipes } from "../../../packages/shared-types/src/diff.js";
import { detectDrift } from "../drift/driftDetector.js";
import { checkInvariants } from "../invariants/invariantChecker.js";
import { hashJson, hashPlan } from "../../../packages/utils/src/hash.js";

export function runRegression(params: {
  baselineRecipe: Recipe;
  candidateRecipe: Recipe;
  baselinePlan: ContextPlan;
  candidatePlan: ContextPlan;
  profile: RegressionProfile;
  viewLookup: (viewId: string) => ViewDefinition;
}): { report: RegressionReport; diffId: string; drift: DriftReport; invariantReport: InvariantReport } {
  const baselinePlanHash = hashPlan(params.baselinePlan);
  const diff = diffRecipes(
    params.baselineRecipe,
    params.candidateRecipe,
    params.baselinePlan,
    params.candidatePlan
  );
  const drift = detectDrift({
    referenceRecipe: params.baselineRecipe,
    currentRecipe: params.candidateRecipe,
    referencePlan: params.baselinePlan,
    currentPlan: params.candidatePlan
  });
  const view = params.viewLookup(params.candidateRecipe.viewId);
  const invariantReport = checkInvariants({
    recipe: params.candidateRecipe,
    plan: params.candidatePlan,
    view
  });

  const exceeded: string[] = [];
  drift.driftSignals.forEach((signal) => {
    if (signal.type === "island_shift" && signal.magnitude > params.profile.driftThresholds.islandShift) {
      exceeded.push("island_shift");
    }
    if (
      signal.type === "token_distribution_shift" &&
      signal.magnitude > params.profile.driftThresholds.tokenDistributionShift
    ) {
      exceeded.push("token_distribution_shift");
    }
    if (signal.type === "anchor_loss" && signal.magnitude > params.profile.driftThresholds.anchorLoss) {
      exceeded.push("anchor_loss");
    }
  });

  const reasons: string[] = [];
  if (baselinePlanHash !== params.profile.baselinePlanHash) {
    reasons.push("baseline plan hash mismatch");
  }
  if (!invariantReport.pass) {
    reasons.push("fatal invariant violation");
  }
  if (exceeded.length > 0) {
    reasons.push(`drift thresholds exceeded: ${exceeded.join(", ")}`);
  }
  if (params.candidatePlan.tokenReport.usedTotal > params.candidatePlan.tokenReport.budgetTotal) {
    reasons.push("token budget regression");
  }

  return {
    diffId: hashJson(diff),
    drift,
    invariantReport,
    report: {
      baselineRecipeId: params.profile.baselineRecipeId,
      candidateRecipeId: params.candidateRecipe.id,
      invariantViolations: invariantReport.violations,
      driftSummary: {
        signals: drift.driftSignals.map((signal) => ({ type: signal.type, magnitude: signal.magnitude })),
        exceededThresholds: exceeded
      },
      pass: reasons.length === 0,
      reasons
    }
  };
}
