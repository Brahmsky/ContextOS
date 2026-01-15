import type { IWritebackController } from "../../../../packages/shared-types/src/contracts.js";
import { appendStore } from "../../../../data-layer/src/jsonStore.js";
import { writeJsonFile } from "../../../../packages/utils/src/files.js";

export class WritebackController implements IWritebackController {
  constructor(private readonly rootDir: string) {}

  // Implementation architecture: writeback must be policy-gated and auditable.
  // See ContextOS 实施架构 3.x + 5.2 on WritebackController ownership.
  async apply(params: { recipe: unknown; assistantText: string }): Promise<void> {
    const timestamp = new Date().toISOString();
    await appendStore(this.rootDir, "recipes", {
      ...params.recipe,
      assistantText: params.assistantText,
      writtenAt: timestamp
    });

    await writeJsonFile(`${this.rootDir}/data/recipes/recipe.json`, params.recipe);
  }
}
