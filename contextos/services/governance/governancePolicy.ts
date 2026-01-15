import { readJsonFile, writeJsonFile } from "../../packages/utils/src/files.js";
import type { GovernancePolicy } from "../../packages/shared-types/src/governance.js";

const defaultPolicy: GovernancePolicy = {
  maxRollbacksPerWindow: 3,
  restrictedScopes: ["global"],
  experimentOnlyScopes: ["planner"]
};

export class GovernancePolicyService {
  constructor(private readonly rootDir: string) {}

  async loadPolicy(): Promise<GovernancePolicy> {
    return readJsonFile(`${this.rootDir}/data/governance_policy.json`, defaultPolicy);
  }

  async savePolicy(policy: GovernancePolicy): Promise<void> {
    await writeJsonFile(`${this.rootDir}/data/governance_policy.json`, policy);
  }
}
