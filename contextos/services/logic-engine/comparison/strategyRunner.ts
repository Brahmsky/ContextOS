import type { StrategyVariant } from "../../../packages/shared-types/src/comparison.js";
import type { Anchor, ContextPlan, ContextSelection, ViewDefinition } from "../../../packages/shared-types/src/types.js";
import type { IContextPlanner } from "../../../packages/shared-types/src/contracts.js";

export type StrategyPlanResult = {
  variant: StrategyVariant;
  view: ViewDefinition;
  plan: ContextPlan;
};

export async function runStrategyPlans(params: {
  message: string;
  variants: StrategyVariant[];
  viewLookup: (viewId: string) => ViewDefinition;
  candidates: ContextSelection;
  planner: IContextPlanner;
  requestIdBase: string;
  stableAnchors: Anchor[];
  window: { streamRecent: number; streamMiddle: number };
}): Promise<StrategyPlanResult[]> {
  const { message, variants, viewLookup, candidates, planner, requestIdBase, stableAnchors, window } = params;
  const results: StrategyPlanResult[] = [];

  for (const [index, variant] of variants.entries()) {
    const baseView = viewLookup(variant.viewVariantId);
    const weights = variant.policyOverrides?.weights ?? baseView.policy.context.weights;
    const view: ViewDefinition = {
      ...baseView,
      policy: {
        ...baseView.policy,
        context: { ...baseView.policy.context, weights }
      }
    };
    const plan = await planner.plan({
      message,
      view,
      candidates,
      requestId: `${requestIdBase}-${index + 1}`,
      stableAnchors,
      window: variant.policyOverrides?.window ?? window
    });
    results.push({ variant, view, plan });
  }

  return results;
}
