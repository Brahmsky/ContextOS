import { readStoreById } from "../../../../data-layer/src/jsonStore.js";
import type { ContextPlan } from "../../../../packages/shared-types/src/types.js";

export class ContextPlansService {
  constructor(private readonly rootDir: string) {}

  async findById(planId: string): Promise<ContextPlan | undefined> {
    return (await readStoreById(this.rootDir, "context_plans", planId)) as ContextPlan | undefined;
  }
}
