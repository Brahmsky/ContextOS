import { randomUUID } from "node:crypto";
import { appendStore } from "../../data-layer/src/jsonStore.js";
import type {
  CanvasBundle,
  CandidatePoolSnapshot,
  CompositionRun,
  ExperimentSpec
} from "../../packages/shared-types/src/experiments.js";
import type { ContextPlan, Recipe, ViewDefinition } from "../../packages/shared-types/src/types.js";
import { diffRecipes } from "../../packages/shared-types/src/diff.js";
import { detectDrift } from "../logic-engine/drift/driftDetector.js";
import { hashJson } from "../../packages/utils/src/hash.js";
import { ContextPlanner } from "../logic-engine/src/planner/contextPlanner.js";
import { AnchorsService } from "../domain-services/src/anchors/service.js";
import { IslandsService } from "../domain-services/src/islands/service.js";
import { StreamService } from "../domain-services/src/stream/service.js";
import { MemoryService } from "../domain-services/src/memory/service.js";
import { RagService } from "../domain-services/src/rag/service.js";
import { loadViews } from "../orchestrator/src/viewLoader.js";
import { ExperimentService } from "./experimentService.js";
import { writeJsonFile } from "../../packages/utils/src/files.js";

const sectionItems = (plan: ContextPlan, sectionId: string) =>
  plan.selectedSections.find((section) => section.id === sectionId)?.items ?? [];

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const buildRecipe = (plan: ContextPlan, view: ViewDefinition): Recipe => ({
  id: randomUUID(),
  requestId: plan.requestId,
  revision: 1,
  timestamp: new Date().toISOString(),
  viewId: view.id,
  viewVersion: view.version,
  viewWeights: view.policy.context.weights,
  plannerVersion: plan.plannerVersion,
  contextPlanId: plan.planId,
  runtimePolicy: view.policy.runtime,
  selectedContext: {
    anchors: sectionItems(plan, "anchors"),
    stream: sectionItems(plan, "stream"),
    islands: sectionItems(plan, "islands"),
    memory: sectionItems(plan, "memory"),
    rag: sectionItems(plan, "rag")
  },
  tokenUsage: {
    budget: plan.tokenReport.budgetTotal,
    used: plan.tokenReport.usedTotal
  },
  modelPlan: {
    modelId: "experiment",
    temperature: view.policy.runtime.temperature,
    messages: [],
    tools: [],
    kvPolicy: "default",
    safety: "standard"
  },
  decisions: { notes: ["experiment"] }
});

type RunPlan = {
  run: CompositionRun;
  plan: ContextPlan;
  view: ViewDefinition;
  planNodeId: string;
};

export class ExperimentRunner {
  constructor(
    private readonly rootDir: string,
    private readonly experimentService: ExperimentService = new ExperimentService(rootDir)
  ) {}

  async createCandidatePoolSnapshot(): Promise<CandidatePoolSnapshot> {
    const anchorsService = new AnchorsService(this.rootDir);
    const streamService = new StreamService(this.rootDir);
    const islandsService = new IslandsService(this.rootDir);
    const memoryService = new MemoryService();
    const ragService = new RagService();

    const anchors = await anchorsService.listAnchors();
    const stableAnchors = await anchorsService.listAnchorRecords();
    const stream = [...(await streamService.recent(6)), ...(await streamService.window(2))];
    const islands = await islandsService.selectCandidates(5);
    const memory = await memoryService.read();
    const rag = await ragService.retrieve();

    const snapshot: CandidatePoolSnapshot = {
      snapshotId: randomUUID(),
      createdAt: new Date().toISOString(),
      anchors,
      stableAnchors,
      stream,
      islands,
      memory,
      rag,
      stats: {
        anchors: anchors.length,
        stream: stream.length,
        islands: islands.length,
        memory: memory.length,
        rag: rag.length
      }
    };
    await this.experimentService.saveCandidateSnapshot(snapshot);
    return snapshot;
  }

  async run(spec: ExperimentSpec): Promise<{ experimentId: string; runs: CompositionRun[]; bundle: CanvasBundle }> {
    if (!["multi_view", "view_blend"].includes(spec.compositionMode)) {
      throw new Error(`Composition mode not supported: ${spec.compositionMode}`);
    }
    const experimentId = randomUUID();
    const snapshot = await this.experimentService.getCandidateSnapshot(spec.candidatePoolSnapshotRef);
    if (!snapshot) {
      throw new Error("Candidate pool snapshot not found.");
    }
    const views = await loadViews(this.rootDir);
    const planner = new ContextPlanner();
    const runs: CompositionRun[] = [];
    const runPlans: RunPlan[] = [];
    const artifactsIndex: CanvasBundle["artifactsIndex"] = [];
    const nodes: CanvasBundle["nodes"] = [];
    const edges: CanvasBundle["edges"] = [];
    const layoutGroups: CanvasBundle["layoutHints"]["groups"] = [];

    const pickView = (viewId: string, version: string) =>
      views.find((view) => view.id === viewId && view.version === version);

    const buildVariantId = (label: string, plannerVariant: string) => `${label}:${plannerVariant}`;

    const resolvedViews = spec.views
      .map((viewSpec) => pickView(viewSpec.viewId, viewSpec.version))
      .filter((view): view is ViewDefinition => Boolean(view));

    if (resolvedViews.length === 0) {
      throw new Error("No matching views found for spec.");
    }

    const viewBlend = (inputs: ViewDefinition[]) => {
      const totalWeight = inputs.reduce((sum, view, index) => {
        const override = spec.views[index]?.weightOverride ?? 1;
        return sum + override;
      }, 0);
      const base = inputs[0];
      const weights = inputs.reduce<Record<string, number>>((acc, view, index) => {
        const override = spec.views[index]?.weightOverride ?? 1;
        Object.entries(view.policy.context.weights).forEach(([key, value]) => {
          acc[key] = (acc[key] ?? 0) + value * override;
        });
        return acc;
      }, {});
      const normalized = Object.fromEntries(
        Object.entries(weights).map(([key, value]) => [key, value / (totalWeight || 1)])
      );
      return {
        ...base,
        id: `blend:${spec.specId}`,
        version: "blend",
        policy: {
          ...base.policy,
          context: {
            ...base.policy.context,
            weights: normalized
          }
        }
      } as ViewDefinition;
    };

    const variants =
      spec.compositionMode === "view_blend"
        ? [{ label: "blend", view: viewBlend(resolvedViews) }]
        : resolvedViews.map((view) => ({ label: view.id, view }));

    for (const plannerVariant of spec.plannerVariants) {
      const groupId = `planner:${plannerVariant}`;
      const groupNodes: string[] = [];
      for (const variant of variants) {
        const requestId = randomUUID();
        const plan = await planner.plan({
          message: spec.message,
          view: variant.view,
          candidates: {
            anchors: snapshot.anchors,
            stream: snapshot.stream,
            islands: snapshot.islands,
            memory: snapshot.memory,
            rag: snapshot.rag
          },
          requestId,
          stableAnchors: snapshot.stableAnchors,
          window: { streamRecent: 6, streamMiddle: 2 },
          exclusions: {
            islands: spec.contextOverrides?.excludeIslands
          }
        });

        const storedPlan = (await appendStore(this.rootDir, "experiment_plans", {
          id: plan.planId,
          ...plan
        })) as { id: string };
        const planRef = `plan:${storedPlan.id}`;
        artifactsIndex.push({ ref: planRef, type: "plan", store: "experiment_plans" });

        const planNodeId = planRef;
        const viewNodeId = `view:${variant.view.id}:${variant.view.version}`;
        if (!nodes.find((node) => node.id === viewNodeId)) {
          nodes.push({ id: viewNodeId, type: "view", label: `${variant.view.id}@${variant.view.version}` });
        }
        nodes.push({
          id: planNodeId,
          type: "plan",
          label: `${variant.view.id}:${plannerVariant}`,
          ref: planRef
        });
        edges.push({
          id: `edge:${viewNodeId}:${planNodeId}`,
          source: viewNodeId,
          target: planNodeId,
          type: "influences"
        });
        groupNodes.push(planNodeId);

        const tokenDistribution = Object.fromEntries(
          Object.entries(plan.tokenReport.byBucket).map(([key, value]) => [
            key,
            value.used / (plan.tokenReport.usedTotal || 1)
          ])
        );
        const anchorRetention = clamp(
          snapshot.anchors.length ? sectionItems(plan, "anchors").length / snapshot.anchors.length : 1
        );

        const run: CompositionRun = {
          runId: randomUUID(),
          experimentId,
          specId: spec.specId,
          variantId: buildVariantId(variant.label, plannerVariant),
          planRef,
          promptHash: hashJson({ message: spec.message, viewId: variant.view.id, plannerVariant }),
          planHash: hashJson(plan),
          metricsSummary: {
            tokenDistribution,
            anchorRetention,
            driftMagnitude: 0
          },
          status: "completed"
        };
        await this.experimentService.saveCompositionRun(run);
        runs.push(run);
        runPlans.push({ run, plan, view: variant.view, planNodeId });
      }
      layoutGroups.push({ id: groupId, label: plannerVariant, nodeIds: groupNodes });
    }

    if (spec.compositionMode === "multi_view") {
      const grouped = new Map<string, RunPlan[]>();
      runPlans.forEach((entry) => {
        const plannerVariant = entry.run.variantId.split(":")[1] ?? "default";
        const list = grouped.get(plannerVariant) ?? [];
        list.push(entry);
        grouped.set(plannerVariant, list);
      });

      grouped.forEach((entries) => {
        for (let i = 0; i < entries.length; i += 1) {
          for (let j = i + 1; j < entries.length; j += 1) {
            const left = entries[i];
            const right = entries[j];
            const leftRecipe = buildRecipe(left.plan, left.view);
            const rightRecipe = buildRecipe(right.plan, right.view);
            const diff = diffRecipes(leftRecipe, rightRecipe, left.plan, right.plan);
            const drift = detectDrift({
              referenceRecipe: leftRecipe,
              currentRecipe: rightRecipe,
              referencePlan: left.plan,
              currentPlan: right.plan
            });
            const diffStored = (await appendStore(this.rootDir, "experiment_diffs", diff)) as { id: string };
            const driftStored = (await appendStore(this.rootDir, "experiment_drifts", drift)) as { id: string };
            const diffRef = `diff:${diffStored.id}`;
            const driftRef = `drift:${driftStored.id}`;
            artifactsIndex.push({ ref: diffRef, type: "diff", store: "experiment_diffs" });
            artifactsIndex.push({ ref: driftRef, type: "drift", store: "experiment_drifts" });

            const diffNodeId = diffRef;
            const driftNodeId = driftRef;
            nodes.push({ id: diffNodeId, type: "diff", label: "diff", ref: diffRef });
            nodes.push({ id: driftNodeId, type: "drift", label: "drift", ref: driftRef });
            edges.push({
              id: `edge:${left.planNodeId}:${diffNodeId}`,
              source: left.planNodeId,
              target: diffNodeId,
              type: "compares"
            });
            edges.push({
              id: `edge:${right.planNodeId}:${diffNodeId}`,
              source: right.planNodeId,
              target: diffNodeId,
              type: "compares"
            });
            edges.push({
              id: `edge:${left.planNodeId}:${driftNodeId}`,
              source: left.planNodeId,
              target: driftNodeId,
              type: "derives"
            });
            edges.push({
              id: `edge:${right.planNodeId}:${driftNodeId}`,
              source: right.planNodeId,
              target: driftNodeId,
              type: "derives"
            });
          }
        }
      });
    }

    const bundle: CanvasBundle = {
      bundleSchemaVersion: "1.0",
      bundleId: randomUUID(),
      experimentId,
      nodes,
      edges,
      layoutHints: { groups: layoutGroups },
      inspectors: {
        view: ["viewId", "version", "weights"],
        plan: ["tokenReport", "droppedItems", "inputsSnapshot"],
        diff: ["contextSelection", "tokenReportChange"],
        drift: ["driftSignals", "suspectedLayers"],
        timeline: ["steps"]
      },
      artifactsIndex
    };

    await this.experimentService.saveCanvasBundle(bundle);
    await writeJsonFile(`${this.rootDir}/data/experiments/canvas-bundle-${experimentId}.json`, bundle);
    return { experimentId, runs, bundle };
  }
}
