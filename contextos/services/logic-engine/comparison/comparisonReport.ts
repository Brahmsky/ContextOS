import type { ComparisonReport, ComparisonVariantResult, PairwiseComparison } from "../../../packages/shared-types/src/comparison.js";
import type { ContextPlan, Recipe } from "../../../packages/shared-types/src/types.js";

export function buildVariantResult(params: {
  variantId: string;
  recipe: Recipe;
  plan: ContextPlan;
}): ComparisonVariantResult {
  const { variantId, recipe, plan } = params;
  const anchors = recipe.selectedContext.anchors.length;
  const stableAnchors = plan.stableAnchors.length || 1;
  const anchorRetention = stableAnchors ? anchors / stableAnchors : 0;

  return {
    variantId,
    recipe,
    plan,
    tokenReport: plan.tokenReport,
    sectionsSummary: plan.selectedSections.map((section) => ({
      id: section.id,
      used: section.tokenEstimate,
      budget: section.budget
    })),
    anchorRetention
  };
}

export function buildComparisonReport(params: {
  inputHash: string;
  variants: ComparisonVariantResult[];
  pairwiseDiffs: PairwiseComparison[];
  heuristicWinner?: string;
}): ComparisonReport {
  return {
    inputHash: params.inputHash,
    variants: params.variants,
    pairwiseDiffs: params.pairwiseDiffs,
    heuristicWinner: params.heuristicWinner
  };
}
