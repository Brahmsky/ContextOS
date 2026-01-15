import type { StrategyKey } from "./strategyMetrics.js";

export type ExperimentScope = "view" | "planner" | "policy";
export type ExperimentIsolationLevel = "sandbox" | "shadow" | "report-only";

export interface ExperimentRun {
  experimentId: string;
  description: string;
  involvedViews: string[];
  baseStrategyRef?: StrategyKey;
  isolationLevel: ExperimentIsolationLevel;
  producedArtifacts: string[];
  eligibleForAdoption: boolean;
  createdAt: string;
}

export interface ExperimentReport {
  experimentId: string;
  scope: ExperimentScope;
  isolationLevel: ExperimentIsolationLevel;
  producedArtifacts: string[];
  summary: {
    comparisons: number;
    metricsNotes: string[];
  };
}
