import type { IIntentEstimator, IntentEstimate, ViewDefinition } from "../../../../packages/shared-types/src/contracts.js";

const keywordMap: Record<string, string[]> = {
  debug: ["debug", "error", "bug", "stack"],
  explore: ["brainstorm", "idea", "explore"],
  critic: ["critic", "review", "risk"],
  plan: ["plan", "roadmap", "milestone"],
  summarize: ["summarize", "summary", "tl;dr"],
  persona: ["persona", "tone", "style"]
};

export class IntentEstimator implements IIntentEstimator {
  // Whitepaper: routing is decided pre-call, not at input time, to allow ambiguity.
  // See ContextOS 实施架构 1.3 on shifting routing to call-time.
  async estimate(message: string, views: ViewDefinition[]): Promise<IntentEstimate> {
    const normalized = message.toLowerCase();
    for (const view of views) {
      const keywords = keywordMap[view.id] ?? [];
      if (keywords.some((keyword) => normalized.includes(keyword))) {
        return { viewId: view.id, confidence: 0.6, notes: ["keyword-match"] };
      }
    }
    return { viewId: views[0]?.id ?? "explore", confidence: 0.3, notes: ["default-view"] };
  }
}
