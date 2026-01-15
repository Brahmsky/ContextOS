import type { ContextPlan, Recipe } from "../../../packages/shared-types/src/types.js";
import type { DriftReport, DriftSignal } from "../../../packages/shared-types/src/drift.js";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const ratioMap = (plan: ContextPlan) => {
  const total = plan.tokenReport.usedTotal || 1;
  const byBucket: Record<string, number> = {};
  Object.entries(plan.tokenReport.byBucket).forEach(([key, value]) => {
    byBucket[key] = value.used / total;
  });
  return byBucket;
};

const l1Distance = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  keys.forEach((key) => {
    sum += Math.abs((a[key] ?? 0) - (b[key] ?? 0));
  });
  return clamp(sum / 2);
};

const islandShiftMagnitude = (prev: Recipe, next: Recipe) => {
  const prevIds = new Set(prev.selectedContext.islands.map((item) => item.id));
  const nextIds = new Set(next.selectedContext.islands.map((item) => item.id));
  const union = new Set([...prevIds, ...nextIds]);
  if (union.size === 0) {
    return 0;
  }
  let intersection = 0;
  prevIds.forEach((id) => {
    if (nextIds.has(id)) {
      intersection += 1;
    }
  });
  const jaccard = intersection / union.size;
  return clamp(1 - jaccard);
};

const anchorLossMagnitude = (prev: Recipe, next: Recipe) => {
  const prevIds = new Set(prev.selectedContext.anchors.map((item) => item.id));
  if (prevIds.size === 0) {
    return 0;
  }
  const nextIds = new Set(next.selectedContext.anchors.map((item) => item.id));
  let lost = 0;
  prevIds.forEach((id) => {
    if (!nextIds.has(id)) {
      lost += 1;
    }
  });
  return clamp(lost / prevIds.size);
};

export function detectDrift(params: {
  referenceRecipe: Recipe;
  currentRecipe: Recipe;
  referencePlan: ContextPlan;
  currentPlan: ContextPlan;
}): DriftReport {
  const { referenceRecipe, currentRecipe, referencePlan, currentPlan } = params;
  const signals: DriftSignal[] = [];
  const suspectedLayers = new Set<"logic-engine" | "orchestrator" | "domain-services">();

  const viewChanged =
    referenceRecipe.viewId !== currentRecipe.viewId ||
    referenceRecipe.viewVersion !== currentRecipe.viewVersion;
  if (viewChanged) {
    signals.push({
      type: "view_change",
      magnitude: 1,
      description: `View changed from ${referenceRecipe.viewId}@${referenceRecipe.viewVersion} to ${currentRecipe.viewId}@${currentRecipe.viewVersion}`
    });
    suspectedLayers.add("orchestrator");
  }

  const tokenShift = l1Distance(ratioMap(referencePlan), ratioMap(currentPlan));
  if (tokenShift > 0) {
    signals.push({
      type: "token_distribution_shift",
      magnitude: tokenShift,
      description: `Token distribution shifted by ${(tokenShift * 100).toFixed(1)}%`
    });
    suspectedLayers.add("logic-engine");
  }

  const islandShift = islandShiftMagnitude(referenceRecipe, currentRecipe);
  if (islandShift > 0) {
    signals.push({
      type: "island_shift",
      magnitude: islandShift,
      description: `Selected islands changed by ${(islandShift * 100).toFixed(1)}%`
    });
    suspectedLayers.add("domain-services");
  }

  const anchorLoss = anchorLossMagnitude(referenceRecipe, currentRecipe);
  if (anchorLoss > 0) {
    signals.push({
      type: "anchor_loss",
      magnitude: anchorLoss,
      description: `Anchor loss at ${(anchorLoss * 100).toFixed(1)}%`
    });
    suspectedLayers.add("logic-engine");
  }

  const confidence = signals.length
    ? clamp(signals.reduce((sum, signal) => sum + signal.magnitude, 0) / signals.length)
    : 0;

  return {
    referenceRecipeId: referenceRecipe.id,
    currentRecipeId: currentRecipe.id,
    driftSignals: signals,
    suspectedLayers: [...suspectedLayers],
    confidence
  };
}
