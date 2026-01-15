import type { ContextPlan, Recipe } from "./types.js";

export type DriftSource = "view" | "planner" | "island" | "stream" | "memory";

export type DriftSignalType =
  | "view_change"
  | "island_shift"
  | "token_distribution_shift"
  | "anchor_loss";

export interface DriftSignal {
  type: DriftSignalType;
  magnitude: number;
  description: string;
}

export interface DriftReport {
  referenceRecipeId: string;
  currentRecipeId: string;
  driftSignals: DriftSignal[];
  suspectedLayers: Array<"logic-engine" | "orchestrator" | "domain-services">;
  confidence: number;
}

export type DriftInput = {
  referenceRecipe: Recipe;
  currentRecipe: Recipe;
  referencePlan: ContextPlan;
  currentPlan: ContextPlan;
};
