import { randomUUID } from "node:crypto";
import { appendStore, readStoreById, readStore, writeStore } from "../../data-layer/src/jsonStore.js";
import type { ExperimentRun, ExperimentReport } from "../../packages/shared-types/src/experiments.js";

export class ExperimentService {
  constructor(private readonly rootDir: string) {}

  async createExperiment(params: {
    description: string;
    involvedViews: string[];
    isolationLevel: ExperimentRun["isolationLevel"];
  }): Promise<ExperimentRun> {
    const experiment: ExperimentRun = {
      experimentId: randomUUID(),
      description: params.description,
      involvedViews: params.involvedViews,
      isolationLevel: params.isolationLevel,
      baseStrategyRef: undefined,
      producedArtifacts: [],
      eligibleForAdoption: false,
      createdAt: new Date().toISOString()
    };
    await appendStore(this.rootDir, "experiments", experiment);
    return experiment;
  }

  async recordReport(report: ExperimentReport): Promise<void> {
    await appendStore(this.rootDir, "experiment_reports", { id: report.experimentId, ...report });
    const experiments = (await readStore(this.rootDir, "experiments")) as ExperimentRun[];
    const updated = experiments.map((experiment) => {
      if (experiment.experimentId !== report.experimentId) {
        return experiment;
      }
      return {
        ...experiment,
        producedArtifacts: [...new Set([...experiment.producedArtifacts, ...report.producedArtifacts])]
      };
    });
    await writeStore(this.rootDir, "experiments", updated);
  }

  async getExperiment(experimentId: string): Promise<ExperimentRun | undefined> {
    return (await readStoreById(this.rootDir, "experiments", experimentId)) as ExperimentRun | undefined;
  }
}
