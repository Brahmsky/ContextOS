import { readStore } from "../../data-layer/src/jsonStore.js";
import type { GovernanceReport } from "../../packages/shared-types/src/governance.js";
import type { PolicyAdoption } from "../../packages/shared-types/src/adoption.js";

export class GovernanceAnalyzer {
  constructor(private readonly rootDir: string) {}

  async analyze(): Promise<GovernanceReport> {
    const adoptions = (await readStore(this.rootDir, "policy_adoptions")) as PolicyAdoption[];

    const total = adoptions.length || 1;
    const accepted = adoptions.filter((entry) => entry.decision === "accept").length;
    const rejected = adoptions.filter((entry) => entry.decision === "reject").length;
    const rollbacks = adoptions.filter((entry) => entry.rollbackRef).length;

    const adoptionByScope = adoptions.reduce<GovernanceReport["adoptionByScope"]>(
      (acc, entry) => ({
        ...acc,
        [entry.scope]: (acc[entry.scope] ?? 0) + 1
      }),
      { view: 0, planner: 0, global: 0 }
    );

    const adoptionByStrategyKey = adoptions.reduce<Record<string, number>>((acc, entry) => {
      const key = `${entry.strategyKey.viewId}:${entry.strategyKey.plannerVariant}:${entry.strategyKey.policySignature}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return {
      generatedAt: new Date().toISOString(),
      totalAdoptions: adoptions.length,
      acceptRate: accepted / total,
      rejectRate: rejected / total,
      rollbackRate: rollbacks / total,
      adoptionByScope,
      adoptionByStrategyKey
    };
  }
}
