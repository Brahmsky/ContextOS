import { randomUUID } from "node:crypto";
import { appendStore, readStore } from "../../data-layer/src/jsonStore.js";
import type { PolicyAdoption, AdoptionTimeline } from "../../packages/shared-types/src/adoption.js";
import type { GovernanceViolation } from "../../packages/shared-types/src/governance.js";
import { GovernancePolicyService } from "../governance/governancePolicy.js";
import { hashJson } from "../../packages/utils/src/hash.js";
import type { Recipe } from "../../packages/shared-types/src/types.js";

export class AdoptionService {
  constructor(private readonly rootDir: string) {}

  async recordAdoption(params: Omit<PolicyAdoption, "adoptionId" | "decidedAt"> & { confirm?: boolean }): Promise<PolicyAdoption> {
    if (!params.rationale.trim()) {
      throw new Error("Adoption rationale is required.");
    }
    const policyService = new GovernancePolicyService(this.rootDir);
    const policy = await policyService.loadPolicy();
    const governanceViolation = await this.evaluateGovernancePolicy(params, policy);
    if (governanceViolation) {
      await appendStore(this.rootDir, "governance_violations", governanceViolation);
      throw new Error(`Governance policy violation: ${governanceViolation.reason}`);
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
    policy: { maxRollbacksPerWindow: number; minRunsBeforeAdoption: number; restrictedScopes: string[]; experimentOnlyScopes: string[] }
  ): Promise<GovernanceViolation | null> {
    if (policy.experimentOnlyScopes.includes(params.scope)) {
      return this.buildViolation(params, "experiment_only_scope", "Scope is restricted to experiments only.");
    }
    if (policy.restrictedScopes.includes(params.scope) && !params.confirm) {
      return this.buildViolation(params, "restricted_scope_requires_confirm", "Restricted scope requires confirmation.");
    }
    const recipes = (await readStore(this.rootDir, "recipes")) as Recipe[];
    const policySignature = hashJson({
      viewId: params.strategyKey.viewId,
      plannerVariant: params.strategyKey.plannerVariant,
      policySignature: params.strategyKey.policySignature
    });
    const matchingRuns = recipes.filter((recipe) => {
      const keySignature = hashJson({
        viewId: recipe.viewId,
        plannerVariant: recipe.plannerVersion,
        policySignature: hashJson({ viewWeights: recipe.viewWeights, runtimePolicy: recipe.runtimePolicy })
      });
      return keySignature === policySignature;
    }).length;
    if (matchingRuns < policy.minRunsBeforeAdoption) {
      return this.buildViolation(
        params,
        "min_runs_before_adoption",
        `Requires at least ${policy.minRunsBeforeAdoption} runs before adoption.`
      );
    }
    const adoptions = (await readStore(this.rootDir, "policy_adoptions")) as PolicyAdoption[];
    const windowStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentRollbacks = adoptions.filter((adoption) => {
      return adoption.rollbackRef && new Date(adoption.decidedAt).getTime() >= windowStart;
    }).length;
    if (recentRollbacks >= policy.maxRollbacksPerWindow) {
      return this.buildViolation(
        params,
        "max_rollbacks_per_window",
        `Exceeded max rollbacks per window (${policy.maxRollbacksPerWindow}).`
      );
    }
    return null;
  }

  private buildViolation(
    params: Omit<PolicyAdoption, "adoptionId" | "decidedAt">,
    policyRule: string,
    reason: string
  ): GovernanceViolation {
    return {
      id: randomUUID(),
      policyRule,
      actorId: params.decidedBy,
      recommendationId: params.recommendationId,
      strategyKey: params.strategyKey,
      reason,
      createdAt: new Date().toISOString()
    };
  }
}
