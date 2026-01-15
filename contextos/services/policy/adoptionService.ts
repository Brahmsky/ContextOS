import { randomUUID } from "node:crypto";
import { appendStore, readStore } from "../../data-layer/src/jsonStore.js";
import type { PolicyAdoption, AdoptionTimeline } from "../../packages/shared-types/src/adoption.js";
import { GovernancePolicyService } from "../governance/governancePolicy.js";

export class AdoptionService {
  constructor(private readonly rootDir: string) {}

  async recordAdoption(params: Omit<PolicyAdoption, "adoptionId" | "decidedAt"> & { confirm?: boolean }): Promise<PolicyAdoption> {
    if (!params.rationale.trim()) {
      throw new Error("Adoption rationale is required.");
    }
    const policyService = new GovernancePolicyService(this.rootDir);
    if (params.decision === "accept") {
      const policy = await policyService.loadPolicy();
      const governanceViolation = await this.evaluateGovernancePolicy(params, policy);
      if (governanceViolation) {
        throw new Error(`Governance policy violation: ${governanceViolation}`);
      }
    }
    const adoption: PolicyAdoption = {
      ...params,
      adoptionId: randomUUID(),
      decidedAt: new Date().toISOString()
    };
    await appendStore(this.rootDir, "policy_adoptions", adoption);
    return adoption;
  }

  async recordTimeline(params: {
    adoptionId: string;
    recommendationId: string;
    beforeStateRefs: Record<string, string>;
    afterStateRefs: Record<string, string>;
  }): Promise<AdoptionTimeline> {
    const timeline: AdoptionTimeline = {
      adoptionId: params.adoptionId,
      recommendationId: params.recommendationId,
      beforeStateRefs: params.beforeStateRefs,
      afterStateRefs: params.afterStateRefs,
      createdAt: new Date().toISOString()
    };
    await appendStore(this.rootDir, "adoption_timelines", timeline);
    return timeline;
  }

  private async evaluateGovernancePolicy(
    params: Omit<PolicyAdoption, "adoptionId" | "decidedAt"> & { confirm?: boolean },
    policy: { maxRollbacksPerWindow: number; restrictedScopes: string[]; experimentOnlyScopes: string[] }
  ): Promise<string | null> {
    if (policy.experimentOnlyScopes.includes(params.scope)) {
      return "Scope is restricted to experiments only.";
    }
    if (policy.restrictedScopes.includes(params.scope) && !params.confirm) {
      return "Restricted scope requires confirmation.";
    }
    const adoptions = (await readStore(this.rootDir, "policy_adoptions")) as PolicyAdoption[];
    const recentRollbacks = adoptions.filter((adoption) => adoption.rollbackRef).length;
    if (recentRollbacks >= policy.maxRollbacksPerWindow) {
      return `Exceeded max rollbacks per window (${policy.maxRollbacksPerWindow}).`;
    }
    return null;
  }
}
