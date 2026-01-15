import { appendStore, readStoreById } from "../../data-layer/src/jsonStore.js";
import type { PolicyAdoption } from "../../packages/shared-types/src/adoption.js";
import { PolicyApplier } from "./policyApplier.js";

export class RollbackService {
  constructor(private readonly rootDir: string, private readonly applier: PolicyApplier) {}

  async rollback(params: { adoptionId: string; decidedBy: string; rationale: string }): Promise<PolicyAdoption> {
    const adoption = (await readStoreById(this.rootDir, "policy_adoptions", params.adoptionId)) as PolicyAdoption;
    if (!adoption) {
      throw new Error("Adoption not found.");
    }
    const fromVersion = (adoption.appliedChanges as { fromVersion?: string }).fromVersion;
    if (!fromVersion) {
      throw new Error("Rollback requires a recorded fromVersion.");
    }
    const rollbackView = await this.applier.rollbackView({
      viewId: adoption.strategyKey.viewId,
      targetVersion: fromVersion
    });
    const rollbackAdoption: PolicyAdoption = {
      adoptionId: `${params.adoptionId}-rollback`,
      recommendationId: adoption.recommendationId,
      strategyKey: adoption.strategyKey,
      scope: adoption.scope,
      decision: "accept",
      decidedBy: params.decidedBy,
      decidedAt: new Date().toISOString(),
      rationale: params.rationale,
      appliedChanges: {
        rollbackOf: adoption.adoptionId,
        rollbackRef: adoption.appliedChanges,
        restoredViewVersion: rollbackView.version
      },
      rollbackRef: adoption.adoptionId
    };
    await appendStore(this.rootDir, "policy_adoptions", rollbackAdoption);
    await appendStore(this.rootDir, "adoption_timelines", {
      adoptionId: rollbackAdoption.adoptionId,
      recommendationId: rollbackAdoption.recommendationId,
      beforeStateRefs: { viewId: adoption.strategyKey.viewId, version: fromVersion },
      afterStateRefs: { viewId: adoption.strategyKey.viewId, version: rollbackView.version },
      createdAt: new Date().toISOString()
    });
    return rollbackAdoption;
  }
}
