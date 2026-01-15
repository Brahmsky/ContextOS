import type { StrategyKey, StrategyMetricsSummary } from "./strategyMetrics.js";

export type RecommendationScope = "view" | "global" | "scenario";

export interface RecommendationRationale {
  strategyKey: StrategyKey;
  rules: string[];
}

export interface RecommendationReport {
  scope: RecommendationScope;
  recommendedStrategies: StrategyMetricsSummary[];
  rejectedStrategies: StrategyMetricsSummary[];
  rationale: RecommendationRationale[];
  confidence: number;
}
