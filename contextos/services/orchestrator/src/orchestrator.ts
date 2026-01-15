import { randomUUID } from "node:crypto";
import { loadViews } from "./viewLoader.js";
import { buildPrompt } from "./promptAssembler.js";
import type { TurnRequest, TurnResponse } from "./types.js";
import type {
  ContextPlan,
  ContextSelection,
  ModelCallPlan,
  Recipe,
  ViewDefinition
} from "../../../packages/shared-types/src/types.js";
import { assertValidContextPlan, assertValidRecipe } from "../../../packages/shared-types/src/schemas.js";
import { StreamService } from "../../domain-services/src/stream/service.js";
import { IslandsService } from "../../domain-services/src/islands/service.js";
import { AnchorsService } from "../../domain-services/src/anchors/service.js";
import { MemoryService } from "../../domain-services/src/memory/service.js";
import { RagService } from "../../domain-services/src/rag/service.js";
import { RecipesService } from "../../domain-services/src/recipes/service.js";
import { ContextPlansService } from "../../domain-services/src/contextPlans/service.js";
import { hashJson } from "../../../packages/utils/src/hash.js";
import { TurnTimeline } from "./timeline/turnTimeline.js";
import { runStrategyPlans } from "../../logic-engine/comparison/strategyRunner.js";
import { buildVariantResult, buildComparisonReport } from "../../logic-engine/comparison/comparisonReport.js";
import { diffRecipes } from "../../../packages/shared-types/src/diff.js";
import { detectDrift } from "../../logic-engine/drift/driftDetector.js";
import type { ComparisonReport, StrategyVariant } from "../../../packages/shared-types/src/comparison.js";
import type { DriftReport } from "../../../packages/shared-types/src/drift.js";
import { appendStore } from "../../../data-layer/src/jsonStore.js";
import { checkInvariants } from "../../logic-engine/invariants/invariantChecker.js";
import { writeJsonFile } from "../../../packages/utils/src/files.js";
import type {
  IContextPlanner,
  IIntentEstimator,
  ILLMAdapter,
  IWritebackController
} from "../../../packages/shared-types/src/contracts.js";

export class Orchestrator {
  constructor(
    private readonly rootDir: string,
    private readonly estimator: IIntentEstimator,
    private readonly planner: IContextPlanner,
    private readonly llmAdapter: ILLMAdapter,
    private readonly writeback: IWritebackController
  ) {}

  // Implementation architecture: Orchestrator orchestrates view selection, context planning,
  // runtime policy, and recipe generation. See ContextOS 实施架构 2.1 + 3.x.
  async handleTurn(request: TurnRequest): Promise<TurnResponse> {
    const requestId = request.requestId ?? randomUUID();
    const timeline = new TurnTimeline(this.rootDir, requestId, request.diagnostics?.timeline ?? false);
    timeline.startStep("load_views");
    const views = await loadViews(this.rootDir);
    timeline.endStep("load_views", views);
    timeline.startStep("estimate");
    const estimatorOut = await this.estimator.estimate(request.message, views);
    timeline.endStep("estimate", estimatorOut);
    const selectedView = this.pickView(views, request.overrides?.viewId ?? estimatorOut.viewId);
    const overrideDenied: string[] = [];
    const freeze = selectedView.freeze ?? {};
    let viewWeights = selectedView.policy.context.weights;
    if (request.overrides?.weightsOverride) {
      if (freeze.planner) {
        overrideDenied.push("weights_override_denied:freeze");
      } else {
        viewWeights = request.overrides.weightsOverride;
      }
    }
    const excludedIslands =
      freeze.contextSources?.includes("islands") ? [] : request.overrides?.excludeIslands ?? [];
    if (request.overrides?.excludeIslands?.length && freeze.contextSources?.includes("islands")) {
      overrideDenied.push("exclude_islands_denied:freeze");
    }
    const effectiveView: ViewDefinition = {
      ...selectedView,
      policy: {
        ...selectedView.policy,
        context: {
          ...selectedView.policy.context,
          weights: viewWeights
        }
      }
    };

    const streamService = new StreamService(this.rootDir);
    const islandsService = new IslandsService(this.rootDir);
    const anchorsService = new AnchorsService(this.rootDir);
    const memoryService = new MemoryService();
    const ragService = new RagService();

    timeline.startStep("stream_append", request.message);
    await streamService.append({
      role: "user",
      content: request.message,
      timestamp: new Date().toISOString()
    });
    timeline.endStep("stream_append");

    timeline.startStep("collect_context");
    const anchors = await anchorsService.listAnchors();
    const stableAnchors = await anchorsService.listAnchorRecords();
    const streamRecent = await streamService.recent(6);
    const streamMiddle = await streamService.window(2);
    const islands = await islandsService.selectCandidates(5);

    const memory = await memoryService.read();
    const rag = effectiveView.policy.runtime.allowRag
      ? await ragService.retrieve()
      : [];
    timeline.endStep("collect_context", { anchors, streamRecent, streamMiddle, islands });

    const candidates: ContextSelection = {
      anchors,
      stream: [...streamRecent, ...streamMiddle],
      islands,
      memory,
      rag
    };

    timeline.startStep("plan");
    const plan = await this.planner.plan({
      message: request.message,
      view: effectiveView,
      candidates,
      requestId,
      stableAnchors,
      window: { streamRecent: 6, streamMiddle: 2 },
      exclusions: { islands: excludedIslands }
    });
    timeline.endStep("plan", plan, { planId: plan.planId });

    timeline.startStep("assemble_prompt");
    const messages = buildPrompt({
      view: effectiveView,
      anchors: this.sectionItems(plan, "anchors"),
      stream: this.sectionItems(plan, "stream"),
      islands: this.sectionItems(plan, "islands"),
      memory: this.sectionItems(plan, "memory"),
      rag: this.sectionItems(plan, "rag"),
      userMessage: request.message
    });
    timeline.endStep("assemble_prompt", messages);

    const modelPlan: ModelCallPlan = {
      modelId: "mock-llm",
      temperature: effectiveView.policy.runtime.temperature,
      messages,
      tools: effectiveView.policy.runtime.allowTools ? ["mock-tool"] : [],
      kvPolicy: "default",
      safety: "standard"
    };

    timeline.startStep("llm_call", modelPlan);
    const completion = await this.llmAdapter.execute(modelPlan);
    timeline.endStep("llm_call", completion);

    const recipe: Recipe = {
      id: randomUUID(),
      requestId,
      revision: request.revision ?? 1,
      parentRecipeId: request.parentRecipeId,
      timestamp: new Date().toISOString(),
      viewId: effectiveView.id,
      viewVersion: effectiveView.version,
      viewWeights,
      plannerVersion: plan.plannerVersion,
      contextPlanId: plan.planId,
      runtimePolicy: {
        temperature: effectiveView.policy.runtime.temperature,
        allowTools: effectiveView.policy.runtime.allowTools,
        allowRag: effectiveView.policy.runtime.allowRag,
        allowMemoryWrite: effectiveView.policy.runtime.allowMemoryWrite,
        kvPolicy: modelPlan.kvPolicy
      },
      selectedContext: {
        anchors: this.sectionItems(plan, "anchors"),
        stream: this.sectionItems(plan, "stream"),
        islands: this.sectionItems(plan, "islands"),
        memory: this.sectionItems(plan, "memory"),
        rag: this.sectionItems(plan, "rag")
      },
      tokenUsage: {
        budget: plan.tokenReport.budgetTotal,
        used: plan.tokenReport.usedTotal
      },
      modelPlan,
      decisions: {
        notes: [...estimatorOut.notes]
      },
      diagnostics: {
        mode: "normal",
        candidateSnapshotHash: plan.inputsSnapshot.candidateHash,
        overrideDenied: overrideDenied.length ? overrideDenied : undefined
      }
    };

    assertValidRecipe(recipe);
    assertValidContextPlan(plan);

    timeline.startStep("stream_append_assistant", completion.text);
    await streamService.append({
      role: "assistant",
      content: completion.text,
      timestamp: new Date().toISOString()
    });
    timeline.endStep("stream_append_assistant");

    timeline.startStep("writeback", recipe);
    await this.writeback.apply({ recipe, assistantText: completion.text, contextPlan: plan });
    timeline.endStep("writeback", { recipeId: recipe.id, planId: plan.planId });
    await timeline.persist({ recipeId: recipe.id, planId: plan.planId });

    const invariantReport = checkInvariants({ recipe, plan, view: effectiveView });
    await appendStore(this.rootDir, "invariant_reports", invariantReport);
    await writeJsonFile(
      `${this.rootDir}/data/invariant_reports/invariant-${recipe.id}.json`,
      invariantReport
    );
    if (!invariantReport.pass) {
      console.warn("Invariant violations detected:", invariantReport.violations);
    }

    this.printRecipeSummary(recipe, plan, completion.text);

    return {
      assistantMessage: completion.text,
      recipe
    };
  }

  // Replay using stored recipe + context plan, without rerunning estimator/planner.
  async replayTurn(recipeId: string): Promise<{
    assistantMessage: string;
    recipe: Recipe;
    planHash: string;
    promptHash: string;
    driftReport: DriftReport;
  }> {
    const recipesService = new RecipesService(this.rootDir);
    const contextPlansService = new ContextPlansService(this.rootDir);
    const recipe = await recipesService.findById(recipeId);
    if (!recipe) {
      throw new Error(`Recipe not found: ${recipeId}`);
    }

    const plan = await contextPlansService.findById(recipe.contextPlanId);
    if (!plan) {
      throw new Error(`ContextPlan not found: ${recipe.contextPlanId}`);
    }

    assertValidRecipe(recipe);
    assertValidContextPlan(plan);

    const views = await loadViews(this.rootDir);
    const baseView = this.pickView(views, recipe.viewId);
    const view: ViewDefinition = {
      ...baseView,
      policy: {
        ...baseView.policy,
        context: {
          ...baseView.policy.context,
          weights: recipe.viewWeights
        }
      }
    };
    if (view.version !== recipe.viewVersion) {
      throw new Error(`View version mismatch for replay: ${view.version} vs ${recipe.viewVersion}`);
    }

    const messages = buildPrompt({
      view,
      anchors: this.sectionItems(plan, "anchors"),
      stream: this.sectionItems(plan, "stream"),
      islands: this.sectionItems(plan, "islands"),
      memory: this.sectionItems(plan, "memory"),
      rag: this.sectionItems(plan, "rag"),
      userMessage: recipe.modelPlan.messages.find((msg) => msg.role === "user")?.content ?? ""
    });

    const modelPlan: ModelCallPlan = {
      ...recipe.modelPlan,
      messages
    };

    const completion = await this.llmAdapter.execute(modelPlan);
    const driftReport = detectDrift({
      referenceRecipe: recipe,
      currentRecipe: recipe,
      referencePlan: plan,
      currentPlan: plan
    });
    await appendStore(this.rootDir, "drift_reports", driftReport);

    return {
      assistantMessage: completion.text,
      recipe,
      planHash: hashJson(plan),
      promptHash: hashJson(messages),
      driftReport
    };
  }

  async compareStrategies(params: {
    message: string;
    variants: StrategyVariant[];
  }): Promise<ComparisonReport> {
    const views = await loadViews(this.rootDir);
    const viewLookup = (id: string) => this.pickView(views, id);
    const anchorsService = new AnchorsService(this.rootDir);
    const islandsService = new IslandsService(this.rootDir);
    const streamService = new StreamService(this.rootDir);
    const memoryService = new MemoryService();
    const ragService = new RagService();

    const stableAnchors = await anchorsService.listAnchorRecords();
    const anchors = await anchorsService.listAnchors();
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

    const requestIdBase = randomUUID();
    const planResults = await runStrategyPlans({
      message: params.message,
      variants: params.variants,
      viewLookup,
      candidates,
      planner: this.planner,
      requestIdBase,
      stableAnchors,
      window: { streamRecent: 6, streamMiddle: 2 }
    });

    const variantResults = await Promise.all(
      planResults.map(async (result, index) => {
        const messages = buildPrompt({
          view: result.view,
          anchors: this.sectionItems(result.plan, "anchors"),
          stream: this.sectionItems(result.plan, "stream"),
          islands: this.sectionItems(result.plan, "islands"),
          memory: this.sectionItems(result.plan, "memory"),
          rag: this.sectionItems(result.plan, "rag"),
          userMessage: params.message
        });
        const modelPlan: ModelCallPlan = {
          modelId: "mock-llm",
          temperature: result.view.policy.runtime.temperature,
          messages,
          tools: result.view.policy.runtime.allowTools ? ["mock-tool"] : [],
          kvPolicy: result.variant.policyOverrides?.kvPolicy ?? "default",
          safety: "standard"
        };
        const recipe: Recipe = {
          id: randomUUID(),
          requestId: `${requestIdBase}-${index + 1}`,
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
            kvPolicy: modelPlan.kvPolicy
          },
          selectedContext: {
            anchors: this.sectionItems(result.plan, "anchors"),
            stream: this.sectionItems(result.plan, "stream"),
            islands: this.sectionItems(result.plan, "islands"),
            memory: this.sectionItems(result.plan, "memory"),
            rag: this.sectionItems(result.plan, "rag")
          },
          tokenUsage: {
            budget: result.plan.tokenReport.budgetTotal,
            used: result.plan.tokenReport.usedTotal
          },
          modelPlan,
          decisions: { notes: [`variant:${result.variant.plannerVariantId}`] },
          diagnostics: {
            mode: "compare",
            candidateSnapshotHash: result.plan.inputsSnapshot.candidateHash,
            expectedPlanHash: hashJson(result.plan)
          }
        };
        await this.writeback.apply({ recipe, assistantText: "diagnostic-run", contextPlan: result.plan });
        return buildVariantResult({
          variantId: `${result.variant.plannerVariantId}:${result.variant.viewVariantId}`,
          recipe,
          plan: result.plan
        });
      })
    );

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
        const diffRecord = await appendStore(this.rootDir, "recipe_diffs", diff);
        const driftRecord = await appendStore(this.rootDir, "drift_reports", drift);
        pairwiseDiffs.push({
          fromVariant: left.variantId,
          toVariant: right.variantId,
          recipeDiffId: String(diffRecord.id),
          driftReportId: String(driftRecord.id)
        });
      }
    }

    return buildComparisonReport({
      inputHash: hashJson({ message: params.message, candidates }),
      variants: variantResults,
      pairwiseDiffs
    });
  }

  private pickView(views: ViewDefinition[], viewId: string): ViewDefinition {
    return views.find((view) => view.id === viewId) ?? views[0];
  }

  private sectionItems(plan: ContextPlan, sectionId: string) {
    return plan.selectedSections.find((section) => section.id === sectionId)?.items ?? [];
  }

  private printRecipeSummary(recipe: Recipe, plan: ContextPlan, assistantText: string): void {
    const droppedByReason = plan.droppedItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.dropReason] = (acc[item.dropReason] ?? 0) + 1;
      return acc;
    }, {});
    const droppedSummary = Object.entries(droppedByReason)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(", ");
    const sectionSummary = plan.selectedSections
      .map((section) => `${section.id} ${section.tokenEstimate}/${section.budget}`)
      .join(" | ");
    const summary = [
      "Recipe Summary",
      `- id: ${recipe.id}`,
      `- view: ${recipe.viewId}@${recipe.viewVersion}`,
      `- tokenUsage: ${recipe.tokenUsage.used}/${recipe.tokenUsage.budget}`,
      `- sections: ${sectionSummary}`,
      `- dropped: ${plan.droppedItems.length} (${droppedSummary || "none"})`,
      `- assistant: ${assistantText}`
    ].join("\n");
    console.log(summary);
  }
}
