import type { ContextItem, ViewDefinition } from "../../../../packages/shared-types/src/types.js";
import { estimateTokens } from "../../../../packages/utils/src/token.js";
import type { ContextPlan, IContextPlanner } from "../../../../packages/shared-types/src/contracts.js";

const sortByScore = (items: ContextItem[]) => [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

function bucketByBudget(items: ContextItem[], budget: number): ContextItem[] {
  const selected: ContextItem[] = [];
  let used = 0;
  for (const item of items) {
    const tokens = item.tokens ?? estimateTokens(item.content);
    if (used + tokens > budget) {
      continue;
    }
    selected.push({ ...item, tokens });
    used += tokens;
  }
  return selected;
}

export class ContextPlanner implements IContextPlanner {
  // Implementation architecture: Planner owns budgets/ordering/compression decisions.
  // See ContextOS 实施架构 3.x for budgeted context planning.
  async plan(params: {
    message: string;
    view: ViewDefinition;
    candidates: ContextPlan["selected"];
  }): Promise<ContextPlan> {
    const { view, candidates } = params;
    const maxTokens = view.policy.context.maxTokens;
    const weights = view.policy.context.weights;

    const budgets = {
      anchors: Math.floor(maxTokens * weights.anchors),
      stream: Math.floor(maxTokens * weights.stream),
      islands: Math.floor(maxTokens * weights.islands),
      memory: Math.floor(maxTokens * weights.memory),
      rag: Math.floor(maxTokens * weights.rag)
    };

    const selected = {
      anchors: bucketByBudget(candidates.anchors, budgets.anchors),
      stream: bucketByBudget(sortByScore(candidates.stream), budgets.stream),
      islands: bucketByBudget(sortByScore(candidates.islands), budgets.islands),
      memory: bucketByBudget(sortByScore(candidates.memory), budgets.memory),
      rag: bucketByBudget(sortByScore(candidates.rag), budgets.rag)
    };

    const usedTokens = Object.values(selected).flat().reduce((acc, item) => acc + (item.tokens ?? 0), 0);

    return {
      selected,
      budget: maxTokens,
      usedTokens,
      notes: ["bucketed-by-weight", `used=${usedTokens}`]
    };
  }
}
