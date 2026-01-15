import { readStoreById } from "../../../../data-layer/src/jsonStore.js";
import type { Recipe } from "../../../../packages/shared-types/src/types.js";

export class RecipesService {
  constructor(private readonly rootDir: string) {}

  async findById(recipeId: string): Promise<Recipe | undefined> {
    return (await readStoreById(this.rootDir, "recipes", recipeId)) as Recipe | undefined;
  }
}
