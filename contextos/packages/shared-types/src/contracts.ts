import type { ContextItem, ModelCallPlan, Recipe, ViewDefinition } from "./types.js";

export interface IntentEstimate {
  viewId: string;
  confidence: number;
  notes: string[];
}

export interface IIntentEstimator {
  estimate(message: string, views: ViewDefinition[]): Promise<IntentEstimate>;
}

export interface ContextPlan {
  selected: {
    anchors: ContextItem[];
    stream: ContextItem[];
    islands: ContextItem[];
    memory: ContextItem[];
    rag: ContextItem[];
  };
  budget: number;
  usedTokens: number;
  notes: string[];
}

export interface IContextPlanner {
  plan(params: {
    message: string;
    view: ViewDefinition;
    candidates: ContextPlan["selected"];
  }): Promise<ContextPlan>;
}

export interface IWritebackController {
  apply(params: {
    recipe: Recipe;
    assistantText: string;
  }): Promise<void>;
}

export interface ILLMAdapter {
  execute(plan: ModelCallPlan): Promise<{ text: string }>;
}
