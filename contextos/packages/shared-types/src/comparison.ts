import type { ContextPlan, Recipe, TokenReport } from "./types.js";

export interface StrategyVariant {
  plannerVariantId: string;
  viewVariantId: string;
  policyOverrides?: {
    weights?: Record<string, number>;
    window?: { streamRecent: number; streamMiddle: number };
    kvPolicy?: "default" | "cache" | "no_cache";
  };
  description?: string;
}

export interface ComparisonVariantResult {
  variantId: string;
  recipe: Recipe;
  plan: ContextPlan;
  tokenReport: TokenReport;
  sectionsSummary: Array<{ id: string; used: number; budget: number }>;
  anchorRetention: number;
}

export interface PairwiseComparison {
  fromVariant: string;
  toVariant: string;
  recipeDiffId: string;
  driftReportId: string;
}

export interface ComparisonReport {
  inputHash: string;
  variants: ComparisonVariantResult[];
  pairwiseDiffs: PairwiseComparison[];
  heuristicWinner?: string;
}
