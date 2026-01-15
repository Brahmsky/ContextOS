import type { InvariantViolation } from "./invariants.js";

export interface RegressionProfile {
  baselineRecipeId: string;
  baselinePlanHash: string;
  invariantsExpectedPass: string[];
  driftThresholds: {
    islandShift: number;
    tokenDistributionShift: number;
    anchorLoss: number;
  };
  description?: string;
}

export interface RegressionReport {
  baselineRecipeId: string;
  candidateRecipeId: string;
  invariantViolations: InvariantViolation[];
  driftSummary: {
    signals: Array<{ type: string; magnitude: number }>;
    exceededThresholds: string[];
  };
  pass: boolean;
  reasons: string[];
}
