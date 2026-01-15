import { readStore } from "../../data-layer/src/jsonStore.js";
import type {
  AdoptionMetrics,
  ActorMetrics,
  GovernanceReport
} from "../../packages/shared-types/src/governance.js";
import type { PolicyAdoption } from "../../packages/shared-types/src/adoption.js";
import type { StrategyMetrics } from "../../packages/shared-types/src/strategyMetrics.js";

const riskProfileFor = (acceptRate: number, rollbackRate: number): ActorMetrics["riskProfile"] => {
  if (rollbackRate > 0.3) {
    return "experimental";
  }
  if (acceptRate > 0.7) {
    return "aggressive";
  }
  return "conservative";
};

export class GovernanceAnalyzer {
  constructor(private readonly rootDir: string) {}

  async analyze(params: { timeWindowDays: number; strategyMetrics: StrategyMetrics[] }): Promise<GovernanceReport> {
    const adoptions = (await readStore(this.rootDir, "policy_adoptions")) as PolicyAdoption[];
    const timelines = (await readStore(this.rootDir, "adoption_timelines")) as Array<{
      adoptionId: string;
      createdAt: string;
      beforeStateRefs: Record<string, string>;
      afterStateRefs: Record<string, string>;
    }>;

    const cutoff = new Date(Date.now() - params.timeWindowDays * 24 * 60 * 60 * 1000);
    const windowed = adoptions.filter((adoption) => new Date(adoption.decidedAt) >= cutoff);

    const total = windowed.length || 1;
    const accepted = windowed.filter((entry) => entry.decision === "accept").length;
    const rejected = windowed.filter((entry) => entry.decision === "reject").length;
    const rollbacks = windowed.filter((entry) => entry.rollbackRef).length;

    const adoptionByScope = windowed.reduce<AdoptionMetrics["adoptionByScope"]>(
      (acc, entry) => {
        acc[entry.scope] = (acc[entry.scope] ?? 0) + 1;
        return acc;
      },
      { view: 0, planner: 0, global: 0 }
    );

    const adoptionByStrategyKey = windowed.reduce<Record<string, number>>((acc, entry) => {
      const key = `${entry.strategyKey.viewId}:${entry.strategyKey.plannerVariant}:${entry.strategyKey.policySignature}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const rollbackDurations = timelines
      .filter((timeline) => windowed.find((adoption) => adoption.adoptionId === timeline.adoptionId))
      .map((timeline) => {
        const adoption = windowed.find((entry) => entry.adoptionId === timeline.adoptionId);
        if (!adoption) {
          return 0;
        }
        return new Date(timeline.createdAt).getTime() - new Date(adoption.decidedAt).getTime();
      })
      .filter((value) => value > 0);

    const avgRollback = rollbackDurations.length
      ? rollbackDurations.reduce((sum, value) => sum + value, 0) / rollbackDurations.length
      : 0;

    const adoptionMetrics: AdoptionMetrics = {
      totalAdoptions: windowed.length,
      acceptRate: accepted / total,
      rejectRate: rejected / total,
      rollbackRate: rollbacks / total,
      avgTimeToRollbackMs: avgRollback,
      adoptionByScope,
      adoptionByStrategyKey
    };

    const actorMap = new Map<string, { total: number; accepts: number; rollbacks: number; views: Record<string, number> }>();
    windowed.forEach((entry) => {
      const actor = actorMap.get(entry.decidedBy) ?? { total: 0, accepts: 0, rollbacks: 0, views: {} };
      actor.total += 1;
      if (entry.decision === "accept") {
        actor.accepts += 1;
      }
      if (entry.rollbackRef) {
        actor.rollbacks += 1;
      }
      actor.views[entry.strategyKey.viewId] = (actor.views[entry.strategyKey.viewId] ?? 0) + 1;
      actorMap.set(entry.decidedBy, actor);
    });

    const actorMetrics: ActorMetrics[] = [...actorMap.entries()].map(([actorId, data]) => {
      const mostAdoptedViews = Object.entries(data.views)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([viewId]) => viewId);
      const acceptRate = data.total ? data.accepts / data.total : 0;
      const rollbackRate = data.total ? data.rollbacks / data.total : 0;
      return {
        actorId,
        totalDecisions: data.total,
        acceptRate,
        rollbackRate,
        mostAdoptedViews,
        riskProfile: riskProfileFor(acceptRate, rollbackRate)
      };
    });

    const riskyPatterns = Object.entries(adoptionByStrategyKey)
      .filter(([, count]) => count >= 3)
      .map(([key]) => `frequent_adoption:${key}`);

    const stabilityCorrelation = params.strategyMetrics.map((metric) => ({
      strategyKey: metric.strategyKey,
      stabilityScore: metric.stabilityScore,
      rollbackRate: adoptionByStrategyKey[
        `${metric.strategyKey.viewId}:${metric.strategyKey.plannerVariant}:${metric.strategyKey.policySignature}`
      ]
        ? adoptionMetrics.rollbackRate
        : 0
    }));

    return {
      timeWindow: {
        start: cutoff.toISOString(),
        end: new Date().toISOString()
      },
      adoptionSummary: adoptionMetrics,
      rollbackSummary: {
        totalRollbacks: rollbacks,
        avgTimeToRollbackMs: avgRollback
      },
      riskyPatterns,
      stabilityCorrelation
    };
  }
}
