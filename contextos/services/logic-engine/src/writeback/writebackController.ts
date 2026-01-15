import type { IWritebackController } from "../../../../packages/shared-types/src/contracts.js";
import { assertValidContextPlan, assertValidRecipe } from "../../../../packages/shared-types/src/schemas.js";
import { appendStore } from "../../../../data-layer/src/jsonStore.js";
import { writeJsonFile } from "../../../../packages/utils/src/files.js";

export class WritebackController implements IWritebackController {
  constructor(private readonly rootDir: string) {}

  // Implementation architecture: writeback must be policy-gated and auditable.
  // See ContextOS 实施架构 3.x + 5.2 on WritebackController ownership.
  async apply(params: { recipe: unknown; assistantText: string; contextPlan: unknown }): Promise<void> {
    try {
      assertValidRecipe(params.recipe);
      assertValidContextPlan(params.contextPlan);
    } catch (error) {
      console.warn("Writeback aborted due to validation error:", error);
      return;
    }
    const timestamp = new Date().toISOString();
    await appendStore(this.rootDir, "recipes", {
      ...params.recipe,
      assistantText: params.assistantText,
      writtenAt: timestamp
    });

    await appendStore(this.rootDir, "context_plans", {
      ...params.contextPlan,
      writtenAt: timestamp
    });

    await writeJsonFile(`${this.rootDir}/data/recipes/recipe.json`, params.recipe);
    await writeJsonFile(`${this.rootDir}/data/context_plans/contextPlan.json`, params.contextPlan);
    const recipeId = (params.recipe as { id?: string }).id ?? "latest";
    const planId = (params.contextPlan as { planId?: string }).planId ?? "latest";
    await writeJsonFile(`${this.rootDir}/data/recipes/recipe-${recipeId}.json`, params.recipe);
    await writeJsonFile(`${this.rootDir}/data/context_plans/contextPlan-${planId}.json`, params.contextPlan);
  }
}
