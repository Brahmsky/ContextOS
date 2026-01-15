import type { StrategyKey } from "./strategyMetrics.js";

export type AdoptionScope = "view" | "planner" | "global";
export type AdoptionDecision = "accept" | "reject" | "defer";

export interface PolicyAdoption {
  adoptionId: string;
  recommendationId: string;
  strategyKey: StrategyKey;
  scope: AdoptionScope;
  decision: AdoptionDecision;
  decidedBy: string;
  decidedAt: string;
  rationale: string;
  appliedChanges: Record<string, unknown>;
  rollbackRef?: string;
}

export interface AdoptionTimeline {
  adoptionId: string;
  recommendationId: string;
  beforeStateRefs: Record<string, string>;
  afterStateRefs: Record<string, string>;
  createdAt: string;
}
