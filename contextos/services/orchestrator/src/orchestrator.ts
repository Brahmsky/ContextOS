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
    const views = await loadViews(this.rootDir);
    const estimatorOut = await this.estimator.estimate(request.message, views);
    const selectedView = this.pickView(views, request.overrides?.viewId ?? estimatorOut.viewId);
    const viewWeights = request.overrides?.weightsOverride ?? selectedView.policy.context.weights;
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

    await streamService.append({
      role: "user",
      content: request.message,
      timestamp: new Date().toISOString()
    });

    const anchors = await anchorsService.listAnchors();
    const stableAnchors = await anchorsService.listAnchorRecords();
    const streamRecent = await streamService.recent(6);
    const streamMiddle = await streamService.window(2);
    const islands = await islandsService.selectCandidates(5);

    const memory = await memoryService.read();
    const rag = effectiveView.policy.runtime.allowRag
      ? await ragService.retrieve()
      : [];

    const candidates: ContextSelection = {
      anchors,
      stream: [...streamRecent, ...streamMiddle],
      islands,
      memory,
      rag
    };

    const plan = await this.planner.plan({
      message: request.message,
      view: effectiveView,
      candidates,
      requestId,
      stableAnchors,
      window: { streamRecent: 6, streamMiddle: 2 },
      exclusions: { islands: request.overrides?.excludeIslands }
    });

    const messages = buildPrompt({
      view: effectiveView,
      anchors: this.sectionItems(plan, "anchors"),
      stream: this.sectionItems(plan, "stream"),
      islands: this.sectionItems(plan, "islands"),
      memory: this.sectionItems(plan, "memory"),
      rag: this.sectionItems(plan, "rag"),
      userMessage: request.message
    });

    const modelPlan: ModelCallPlan = {
      modelId: "mock-llm",
      temperature: effectiveView.policy.runtime.temperature,
      messages,
      tools: effectiveView.policy.runtime.allowTools ? ["mock-tool"] : [],
      kvPolicy: "default",
      safety: "standard"
    };

    const completion = await this.llmAdapter.execute(modelPlan);

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
      }
    };

    assertValidRecipe(recipe);
    assertValidContextPlan(plan);

    await streamService.append({
      role: "assistant",
      content: completion.text,
      timestamp: new Date().toISOString()
    });

    await this.writeback.apply({ recipe, assistantText: completion.text, contextPlan: plan });

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

    return {
      assistantMessage: completion.text,
      recipe,
      planHash: hashJson(plan),
      promptHash: hashJson(messages)
    };
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
