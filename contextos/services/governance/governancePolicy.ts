import { readStore, writeStore } from "../../data-layer/src/jsonStore.js";
import type { GovernancePolicy } from "../../packages/shared-types/src/governance.js";

const defaultPolicy: GovernancePolicy = {
  maxRollbacksPerWindow: 3,
  minRunsBeforeAdoption: 3,
  restrictedScopes: ["global"],
  experimentOnlyScopes: ["planner"]
};

export class GovernancePolicyService {
  constructor(private readonly rootDir: string) {}

  async loadPolicy(): Promise<GovernancePolicy> {
    const stored = (await readStore(this.rootDir, "governance_policies")) as GovernancePolicy[];
    return stored[0] ?? defaultPolicy;
  }

  async savePolicy(policy: GovernancePolicy): Promise<void> {
    await writeStore(this.rootDir, "governance_policies", [policy]);
  }
}
