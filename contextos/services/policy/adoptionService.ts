import { randomUUID } from "node:crypto";
import { appendStore } from "../../data-layer/src/jsonStore.js";
import type { PolicyAdoption, AdoptionTimeline } from "../../packages/shared-types/src/adoption.js";

export class AdoptionService {
  constructor(private readonly rootDir: string) {}

  async recordAdoption(params: Omit<PolicyAdoption, "adoptionId" | "decidedAt">): Promise<PolicyAdoption> {
    if (!params.rationale.trim()) {
      throw new Error("Adoption rationale is required.");
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
}
