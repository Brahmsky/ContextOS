export type ExperimentIsolationLevel = "sandbox" | "shadow" | "report-only";

export interface ExperimentRun {
  experimentId: string;
  description: string;
  involvedViews: string[];
  isolationLevel: ExperimentIsolationLevel;
  createdAt: string;
}
