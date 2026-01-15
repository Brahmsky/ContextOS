import type { Anchor, ContextPlan, ContextSelection, ModelCallPlan, Recipe, ViewDefinition } from "./types.js";

export interface IntentEstimate {
  viewId: string;
  confidence: number;
  notes: string[];
}

export interface IIntentEstimator {
  estimate(message: string, views: ViewDefinition[]): Promise<IntentEstimate>;
}

export interface IContextPlanner {
  plan(params: {
    message: string;
    view: ViewDefinition;
    candidates: ContextSelection;
    requestId: string;
    stableAnchors: Anchor[];
    window: { streamRecent: number; streamMiddle: number };
    exclusions?: { islands?: string[] };
  }): Promise<ContextPlan>;
}

export interface IWritebackController {
  apply(params: {
    recipe: Recipe;
    assistantText: string;
    contextPlan: ContextPlan;
  }): Promise<void>;
}

export interface ILLMAdapter {
  execute(plan: ModelCallPlan): Promise<{ text: string }>;
}
