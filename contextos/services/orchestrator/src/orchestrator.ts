import { randomUUID } from "node:crypto";
import { loadViews } from "./viewLoader.js";
import { buildPrompt } from "./promptAssembler.js";
import type { TurnRequest, TurnResponse } from "./types.js";
import type {
  ModelCallPlan,
  Recipe,
  ViewDefinition
} from "../../../packages/shared-types/src/types.js";
import { assertValidRecipe } from "../../../packages/shared-types/src/schemas.js";
import { StreamService } from "../../domain-services/src/stream/service.js";
import { IslandsService } from "../../domain-services/src/islands/service.js";
import { AnchorsService } from "../../domain-services/src/anchors/service.js";
import { MemoryService } from "../../domain-services/src/memory/service.js";
import { RagService } from "../../domain-services/src/rag/service.js";
import type {
  ContextPlan,
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
    const views = await loadViews(this.rootDir);
    const estimatorOut = await this.estimator.estimate(request.message, views);
    const selectedView = this.pickView(views, estimatorOut.viewId);

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
    const streamRecent = await streamService.recent(6);
    const streamMiddle = await streamService.window(2);
    const islands = await islandsService.selectCandidates(5);

    const memory = await memoryService.read();
    const rag = selectedView.policy.runtime.allowRag
      ? await ragService.retrieve()
      : [];

    const candidates: ContextPlan["selected"] = {
      anchors,
      stream: [...streamRecent, ...streamMiddle],
      islands,
      memory,
      rag
    };

    const plan = await this.planner.plan({
      message: request.message,
      view: selectedView,
      candidates
    });

    const messages = buildPrompt({
      view: selectedView,
      anchors: plan.selected.anchors,
      stream: plan.selected.stream,
      islands: plan.selected.islands,
      memory: plan.selected.memory,
      rag: plan.selected.rag,
      userMessage: request.message
    });

    const modelPlan: ModelCallPlan = {
      modelId: "mock-llm",
      temperature: selectedView.policy.runtime.temperature,
      messages,
      tools: selectedView.policy.runtime.allowTools ? ["mock-tool"] : [],
      kvPolicy: "default",
      safety: "standard"
    };

    const completion = await this.llmAdapter.execute(modelPlan);

    const recipe: Recipe = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      viewId: selectedView.id,
      viewVersion: selectedView.version,
      selectedContext: plan.selected,
      tokenUsage: {
        budget: plan.budget,
        used: plan.usedTokens
      },
      modelPlan,
      decisions: {
        notes: [...estimatorOut.notes, ...plan.notes]
      }
    };

    assertValidRecipe(recipe);

    await streamService.append({
      role: "assistant",
      content: completion.text,
      timestamp: new Date().toISOString()
    });

    await this.writeback.apply({ recipe, assistantText: completion.text });

    this.printRecipeSummary(recipe, completion.text);

    return {
      assistantMessage: completion.text,
      recipe
    };
  }

  private pickView(views: ViewDefinition[], viewId: string): ViewDefinition {
    return views.find((view) => view.id === viewId) ?? views[0];
  }

  private printRecipeSummary(recipe: Recipe, assistantText: string): void {
    const summary = [
      "Recipe Summary",
      `- id: ${recipe.id}`,
      `- view: ${recipe.viewId}@${recipe.viewVersion}`,
      `- tokenUsage: ${recipe.tokenUsage.used}/${recipe.tokenUsage.budget}`,
      `- assistant: ${assistantText}`
    ].join("\n");
    console.log(summary);
  }
}
