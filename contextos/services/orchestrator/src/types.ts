import type { Recipe } from "../../../packages/shared-types/src/types.js";

export type TurnRequest = {
  userId: string;
  threadId: string;
  message: string;
};

export type TurnResponse = {
  assistantMessage: string;
  recipe: Recipe;
};
