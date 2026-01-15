import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "../../packages/utils/src/files.js";
import type { ExperimentRun } from "../../packages/shared-types/src/experiments.js";

export class ExperimentService {
  constructor(private readonly rootDir: string) {}

  async createExperiment(params: {
    description: string;
    involvedViews: string[];
    isolationLevel: ExperimentRun["isolationLevel"];
  }): Promise<ExperimentRun> {
    const runs = await this.listExperiments();
    const experiment: ExperimentRun = {
      experimentId: randomUUID(),
      description: params.description,
      involvedViews: params.involvedViews,
      isolationLevel: params.isolationLevel,
      createdAt: new Date().toISOString()
    };
    runs.push(experiment);
    await this.writeRuns(runs);
    return experiment;
  }

  async listExperiments(): Promise<ExperimentRun[]> {
    return readJsonFile(`${this.rootDir}/data/experiment_run.json`, [] as ExperimentRun[]);
  }

  private async writeRuns(runs: ExperimentRun[]): Promise<void> {
    await writeJsonFile(`${this.rootDir}/data/experiment_run.json`, runs);
  }
}
