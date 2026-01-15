import type { Recipe } from "../../../packages/shared-types/src/types.js";

export type TurnRequest = {
  userId: string;
  threadId: string;
  message: string;
  requestId?: string;
  revision?: number;
  parentRecipeId?: string;
  overrides?: {
    viewId?: string;
    excludeIslands?: string[];
    weightsOverride?: Record<string, number>;
  };
  diagnostics?: {
    timeline?: boolean;
  };
};

export type TurnResponse = {
  assistantMessage: string;
  recipe: Recipe;
};
