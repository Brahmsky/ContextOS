import { randomUUID } from "node:crypto";
import { appendStore, readStore, readStoreById } from "../../data-layer/src/jsonStore.js";
import type {
  CandidatePoolSnapshot,
  CanvasBundle,
  CompositionRun,
  ExperimentSpec
} from "../../packages/shared-types/src/experiments.js";

export class ExperimentService {
  constructor(private readonly rootDir: string) {}

  async createSpec(params: Omit<ExperimentSpec, "specId" | "createdAt">): Promise<ExperimentSpec> {
    const spec: ExperimentSpec = {
      ...params,
      specId: randomUUID(),
      createdAt: new Date().toISOString()
    };
    await appendStore(this.rootDir, "experiment_specs", spec);
    return spec;
  }

  async listSpecs(): Promise<ExperimentSpec[]> {
    return (await readStore(this.rootDir, "experiment_specs")) as ExperimentSpec[];
  }

  async getSpec(specId: string): Promise<ExperimentSpec | undefined> {
    return (await readStoreById(this.rootDir, "experiment_specs", specId)) as ExperimentSpec | undefined;
  }

  async saveCandidateSnapshot(snapshot: CandidatePoolSnapshot): Promise<void> {
    await appendStore(this.rootDir, "candidate_pool_snapshots", snapshot);
  }

  async getCandidateSnapshot(snapshotId: string): Promise<CandidatePoolSnapshot | undefined> {
    return (await readStoreById(this.rootDir, "candidate_pool_snapshots", snapshotId)) as
      | CandidatePoolSnapshot
      | undefined;
  }

  async saveCompositionRun(run: CompositionRun): Promise<void> {
    await appendStore(this.rootDir, "composition_runs", run);
  }

  async listCompositionRuns(experimentId: string): Promise<CompositionRun[]> {
    const runs = (await readStore(this.rootDir, "composition_runs")) as CompositionRun[];
    return runs.filter((run) => run.experimentId === experimentId);
  }

  async saveCanvasBundle(bundle: CanvasBundle): Promise<void> {
    await appendStore(this.rootDir, "canvas_bundles", bundle);
  }

  async getCanvasBundle(experimentId: string): Promise<CanvasBundle | undefined> {
    const bundles = (await readStore(this.rootDir, "canvas_bundles")) as CanvasBundle[];
    return bundles.find((bundle) => bundle.experimentId === experimentId);
  }
}
