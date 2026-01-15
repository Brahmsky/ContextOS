import type {
  Anchor,
  ContextItem,
  ContextPlan,
  ContextSelection,
  DroppedItem,
  ViewDefinition
} from "../../../../packages/shared-types/src/types.js";
import { estimateTokens } from "../../../../packages/utils/src/token.js";
import type { IContextPlanner } from "../../../../packages/shared-types/src/contracts.js";

const sortByScore = (items: ContextItem[]) => [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

type SectionPlan = { selected: ContextItem[]; dropped: DroppedItem[]; used: number };

const LOW_SCORE_THRESHOLD = 0.2;

function evaluateDropReason(item: ContextItem, used: number, budget: number, seen: Set<string>): DropReason | null {
  if (seen.has(item.id)) {
    return "duplicate";
  }
  if (typeof item.score === "number" && item.score < LOW_SCORE_THRESHOLD) {
    return "low_score";
  }
  const tokens = item.tokens ?? estimateTokens(item.content);
  if (used + tokens > budget) {
    return "budget_exceeded";
  }
  return null;
}

function planSection(items: ContextItem[], budget: number, denied: boolean): SectionPlan {
  const selected: ContextItem[] = [];
  const dropped: DroppedItem[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const item of items) {
    const tokens = item.tokens ?? estimateTokens(item.content);
    const resolved = { ...item, tokens };
    if (denied) {
      dropped.push({
        id: item.id,
        type: item.type,
        source: item.source,
        score: item.score,
        dropReason: "denied_by_policy",
        reasonNotes: ["policy-deny"]
      });
      continue;
    }
    const dropReason = evaluateDropReason(resolved, used, budget, seen);
    if (dropReason) {
      dropped.push({
        id: resolved.id,
        type: resolved.type,
        source: resolved.source,
        score: resolved.score,
        dropReason,
        reasonNotes: [dropReason]
      });
      continue;
    }
    selected.push(resolved);
    seen.add(resolved.id);
    used += tokens;
  }

  return { selected, dropped, used };
}

export class ContextPlanner implements IContextPlanner {
  // Implementation architecture: Planner owns budgets/ordering/compression decisions.
  // See ContextOS 实施架构 3.x for budgeted context planning.
  async plan(params: {
    message: string;
    view: ViewDefinition;
    candidates: ContextSelection;
    requestId: string;
    stableAnchors: Anchor[];
    window: { streamRecent: number; streamMiddle: number };
    exclusions?: { islands?: string[] };
  }): Promise<ContextPlan> {
    const { view, candidates, requestId, stableAnchors, window, exclusions } = params;
    const maxTokens = view.policy.context.maxTokens;
    const weights = view.policy.context.weights;

    const budgets: Record<string, number> = {
      anchors: Math.floor(maxTokens * weights.anchors),
      stream: Math.floor(maxTokens * weights.stream),
      islands: Math.floor(maxTokens * weights.islands),
      memory: Math.floor(maxTokens * weights.memory),
      rag: Math.floor(maxTokens * weights.rag)
    };

    const anchorPlan = planSection(candidates.anchors, budgets.anchors, false);
    const streamPlan = planSection(sortByScore(candidates.stream), budgets.stream, false);
    const excludedIslands = new Set(exclusions?.islands ?? []);
    const islandCandidates = sortByScore(candidates.islands);
    const excludedIslandDrops = islandCandidates
      .filter((item) => excludedIslands.has(item.id))
      .map((item) => ({
        id: item.id,
        type: item.type,
        source: item.source,
        score: item.score,
        dropReason: "denied_by_policy" as const,
        reasonNotes: ["override-exclude"]
      }));
    const islandPlan = planSection(
      islandCandidates.filter((item) => !excludedIslands.has(item.id)),
      budgets.islands,
      false
    );
    const memoryPlan = planSection(sortByScore(candidates.memory), budgets.memory, false);
    const ragPlan = planSection(sortByScore(candidates.rag), budgets.rag, !view.policy.runtime.allowRag);

    const selected = {
      anchors: anchorPlan.selected,
      stream: streamPlan.selected,
      islands: islandPlan.selected,
      memory: memoryPlan.selected,
      rag: ragPlan.selected
    };

    const usedTokens = Object.values(selected).flat().reduce((acc, item) => acc + (item.tokens ?? 0), 0);

    const droppedItems = [
      ...anchorPlan.dropped,
      ...streamPlan.dropped,
      ...islandPlan.dropped,
      ...excludedIslandDrops,
      ...memoryPlan.dropped,
      ...ragPlan.dropped
    ];

    return {
      planId: `${requestId}-plan`,
      requestId,
      plannerVersion: "v1",
      selectedSections: [
        {
          id: "anchors",
          label: "Anchors",
          items: selected.anchors,
          tokenEstimate: anchorPlan.used,
          budget: budgets.anchors
        },
        {
          id: "stream",
          label: "Stream",
          items: selected.stream,
          tokenEstimate: streamPlan.used,
          budget: budgets.stream
        },
        {
          id: "islands",
          label: "Islands",
          items: selected.islands,
          tokenEstimate: islandPlan.used,
          budget: budgets.islands
        },
        {
          id: "memory",
          label: "Memory",
          items: selected.memory,
          tokenEstimate: memoryPlan.used,
          budget: budgets.memory
        },
        {
          id: "rag",
          label: "RAG",
          items: selected.rag,
          tokenEstimate: ragPlan.used,
          budget: budgets.rag
        }
      ],
      stableAnchors,
      tokenReport: {
        budgetTotal: maxTokens,
        usedTotal: usedTokens,
        byBucket: {
          anchors: { budget: budgets.anchors, used: anchorPlan.used },
          stream: { budget: budgets.stream, used: streamPlan.used },
          islands: { budget: budgets.islands, used: islandPlan.used },
          memory: { budget: budgets.memory, used: memoryPlan.used },
          rag: { budget: budgets.rag, used: ragPlan.used }
        }
      },
      droppedItems,
      inputsSnapshot: {
        candidateCounts: {
          anchors: candidates.anchors.length,
          stream: candidates.stream.length,
          islands: candidates.islands.length,
          memory: candidates.memory.length,
          rag: candidates.rag.length
        },
        weights,
        window,
        thresholds: { lowScore: LOW_SCORE_THRESHOLD }
      }
    };
  }
}
