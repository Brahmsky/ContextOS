import { hashJson } from "../../packages/utils/src/hash.js";
import type { StrategyVariant } from "../../packages/shared-types/src/comparison.js";
import type { ComparisonReport } from "../../packages/shared-types/src/comparison.js";
import type { ExperimentReport, ExperimentRun } from "../../packages/shared-types/src/experiments.js";
import { runStrategyPlans } from "../logic-engine/comparison/strategyRunner.js";
import { buildComparisonReport, buildVariantResult } from "../logic-engine/comparison/comparisonReport.js";
import { detectDrift } from "../logic-engine/drift/driftDetector.js";
import { diffRecipes } from "../../packages/shared-types/src/diff.js";
import { loadViews } from "../orchestrator/src/viewLoader.js";
import type { ContextSelection, Recipe, ViewDefinition } from "../../packages/shared-types/src/types.js";
import { StreamService } from "../domain-services/src/stream/service.js";
import { AnchorsService } from "../domain-services/src/anchors/service.js";
import { IslandsService } from "../domain-services/src/islands/service.js";
import { MemoryService } from "../domain-services/src/memory/service.js";
import { RagService } from "../domain-services/src/rag/service.js";
import type { IContextPlanner } from "../../packages/shared-types/src/contracts.js";

export class ExperimentRunner {
  constructor(private readonly rootDir: string, private readonly planner: IContextPlanner) {}

  async run(params: {
    experiment: ExperimentRun;
    message: string;
    variants: StrategyVariant[];
  }): Promise<{ report: ExperimentReport; comparison: ComparisonReport }> {
    const views = await loadViews(this.rootDir);
    const viewLookup = (id: string) => views.find((view) => view.id === id) ?? views[0];

    const anchorsService = new AnchorsService(this.rootDir);
    const islandsService = new IslandsService(this.rootDir);
    const streamService = new StreamService(this.rootDir);
    const memoryService = new MemoryService();
    const ragService = new RagService();

    const anchors = await anchorsService.listAnchors();
    const stableAnchors = await anchorsService.listAnchorRecords();
    const streamRecent = await streamService.recent(6);
    const streamMiddle = await streamService.window(2);
    const islands = await islandsService.selectCandidates(5);
    const memory = await memoryService.read();
    const rag = await ragService.retrieve();

    const candidates: ContextSelection = {
      anchors,
      stream: [...streamRecent, ...streamMiddle],
      islands,
      memory,
      rag
    };

    const planResults = await runStrategyPlans({
      message: params.message,
      variants: params.variants,
      viewLookup,
      candidates,
      planner: this.planner,
      requestIdBase: params.experiment.experimentId,
      stableAnchors,
      window: { streamRecent: 6, streamMiddle: 2 }
    });

    const variantResults = planResults.map((result, index) => {
      const recipe: Recipe = {
        id: `${params.experiment.experimentId}-recipe-${index + 1}`,
        requestId: params.experiment.experimentId,
        revision: 1,
        timestamp: new Date().toISOString(),
        viewId: result.view.id,
        viewVersion: result.view.version,
        viewWeights: result.view.policy.context.weights,
        plannerVersion: result.plan.plannerVersion,
        contextPlanId: result.plan.planId,
        runtimePolicy: {
          temperature: result.view.policy.runtime.temperature,
          allowTools: result.view.policy.runtime.allowTools,
          allowRag: result.view.policy.runtime.allowRag,
          allowMemoryWrite: result.view.policy.runtime.allowMemoryWrite,
          kvPolicy: "default"
        },
        selectedContext: {
          anchors: result.plan.selectedSections.find((section) => section.id === "anchors")?.items ?? [],
          stream: result.plan.selectedSections.find((section) => section.id === "stream")?.items ?? [],
          islands: result.plan.selectedSections.find((section) => section.id === "islands")?.items ?? [],
          memory: result.plan.selectedSections.find((section) => section.id === "memory")?.items ?? [],
          rag: result.plan.selectedSections.find((section) => section.id === "rag")?.items ?? []
        },
        tokenUsage: {
          budget: result.plan.tokenReport.budgetTotal,
          used: result.plan.tokenReport.usedTotal
        },
        modelPlan: {
          modelId: "mock-llm",
          temperature: result.view.policy.runtime.temperature,
          messages: [],
          tools: [],
          kvPolicy: "default",
          safety: "standard"
        },
        decisions: { notes: ["experiment"] },
        diagnostics: {
          mode: "compare",
          candidateSnapshotHash: result.plan.inputsSnapshot.candidateHash,
          expectedPlanHash: hashJson(result.plan)
        }
      };
      return buildVariantResult({
        variantId: `${result.variant.plannerVariantId}:${result.variant.viewVariantId}`,
        recipe,
        plan: result.plan
      });
    });

    const pairwiseDiffs = [];
    for (let i = 0; i < variantResults.length; i += 1) {
      for (let j = i + 1; j < variantResults.length; j += 1) {
        const left = variantResults[i];
        const right = variantResults[j];
        const diff = diffRecipes(left.recipe, right.recipe, left.plan, right.plan);
        const drift = detectDrift({
          referenceRecipe: left.recipe,
          currentRecipe: right.recipe,
          referencePlan: left.plan,
          currentPlan: right.plan
        });
        pairwiseDiffs.push({
          fromVariant: left.variantId,
          toVariant: right.variantId,
          recipeDiffId: diff.nextRecipeId,
          driftReportId: drift.currentRecipeId
        });
      }
    }

    const comparison = buildComparisonReport({
      inputHash: hashJson({ message: params.message, candidates }),
      variants: variantResults,
      pairwiseDiffs
    });

    const report: ExperimentReport = {
      experimentId: params.experiment.experimentId,
      scope: "view",
      isolationLevel: params.experiment.isolationLevel,
      producedArtifacts: ["comparison"],
      summary: {
        comparisons: pairwiseDiffs.length,
        metricsNotes: ["report-only"]
      }
    };

    return { report, comparison };
  }
}
