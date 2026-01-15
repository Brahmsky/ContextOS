import type { ContextPlan, DroppedItem, Recipe, RecipeDiff } from "./types.js";

const idsFrom = (items: { id: string }[]) => new Set(items.map((item) => item.id));

const diffIds = (prev: { id: string }[], next: { id: string }[]) => {
  const prevSet = idsFrom(prev);
  const nextSet = idsFrom(next);
  const added = [...nextSet].filter((id) => !prevSet.has(id));
  const removed = [...prevSet].filter((id) => !nextSet.has(id));
  return { added, removed };
};

const diffDroppedItems = (prev: DroppedItem[], next: DroppedItem[]) => {
  const prevSet = idsFrom(prev);
  const nextSet = idsFrom(next);
  const added = next.filter((item) => !prevSet.has(item.id));
  const removed = prev.filter((item) => !nextSet.has(item.id));
  return { added, removed };
};

export function diffRecipes(prev: Recipe, next: Recipe, prevPlan: ContextPlan, nextPlan: ContextPlan): RecipeDiff {
  const islands = diffIds(prev.selectedContext.islands, next.selectedContext.islands);
  const anchors = diffIds(prev.selectedContext.anchors, next.selectedContext.anchors);
  const streamCounts = {
    previousCount: prev.selectedContext.stream.length,
    nextCount: next.selectedContext.stream.length
  };

  return {
    previousRecipeId: prev.id,
    nextRecipeId: next.id,
    viewChange: {
      previous: {
        id: prev.viewId,
        version: prev.viewVersion,
        weights: prev.viewWeights
      },
      next: {
        id: next.viewId,
        version: next.viewVersion,
        weights: next.viewWeights
      }
    },
    contextSelection: {
      addedIslands: islands.added,
      removedIslands: islands.removed,
      addedAnchors: anchors.added,
      removedAnchors: anchors.removed,
      streamWindowChange: streamCounts
    },
    tokenReportChange: {
      previous: prevPlan.tokenReport,
      next: nextPlan.tokenReport
    },
    droppedItemsChange: diffDroppedItems(prevPlan.droppedItems, nextPlan.droppedItems),
    runtimePolicyChange: {
      previous: prev.runtimePolicy,
      next: next.runtimePolicy
    }
  };
}
