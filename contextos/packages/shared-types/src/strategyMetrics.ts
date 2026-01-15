import type { InvariantSeverity } from "./invariants.js";

export interface StrategyKey {
  viewId: string;
  plannerVariant: string;
  policySignature: string;
}

export interface StrategyMetrics {
  strategyKey: StrategyKey;
  totalRuns: number;
  invariantViolationRate: Record<InvariantSeverity, number>;
  avgDriftMagnitude: number;
  regressionFailRate: number;
  avgTokenUtilization: number;
  stabilityScore: number;
}

export interface StrategyMetricsSummary {
  strategyKey: StrategyKey;
  stabilityScore: number;
  avgDriftMagnitude: number;
  invariantViolationRate: Record<InvariantSeverity, number>;
  regressionFailRate: number;
  avgTokenUtilization: number;
}
