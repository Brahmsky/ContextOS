import { appendStore } from "../../../data-layer/src/jsonStore.js";
import { writeJsonFile } from "../../../packages/utils/src/files.js";
import { hashJson } from "../../../packages/utils/src/hash.js";

export type TimelineStep = {
  stepName: string;
  startTs: number;
  endTs: number;
  inputHash?: string;
  outputHash?: string;
  artifactRefs?: Record<string, string>;
};

export class TurnTimeline {
  private steps: TimelineStep[] = [];
  private active: Map<string, TimelineStep> = new Map();

  constructor(
    private readonly rootDir: string,
    private readonly requestId: string,
    private readonly enabled: boolean
  ) {}

  startStep(stepName: string, input?: unknown): void {
    if (!this.enabled) {
      return;
    }
    const step: TimelineStep = {
      stepName,
      startTs: Date.now(),
      endTs: Date.now(),
      inputHash: input ? hashJson(input) : undefined
    };
    this.active.set(stepName, step);
  }

  endStep(stepName: string, output?: unknown, artifactRefs?: Record<string, string>): void {
    if (!this.enabled) {
      return;
    }
    const step = this.active.get(stepName);
    if (!step) {
      return;
    }
    step.endTs = Date.now();
    step.outputHash = output ? hashJson(output) : undefined;
    step.artifactRefs = artifactRefs;
    this.steps.push(step);
    this.active.delete(stepName);
  }

  async persist(params: { recipeId?: string; planId?: string }): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const payload = {
      id: params.recipeId ?? this.requestId,
      requestId: this.requestId,
      steps: this.steps,
      createdAt: new Date().toISOString(),
      recipeId: params.recipeId,
      planId: params.planId
    };
    await appendStore(this.rootDir, "timelines", payload);
    await writeJsonFile(`${this.rootDir}/data/timelines/timeline-${payload.id}.json`, payload);
  }
}
