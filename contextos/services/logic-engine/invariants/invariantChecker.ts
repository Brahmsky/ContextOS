import type { ContextPlan, Recipe, ViewDefinition } from "../../../packages/shared-types/src/types.js";
import type { InvariantReport, InvariantViolation } from "../../../packages/shared-types/src/invariants.js";
import { invariantDefinitions } from "./invariantDefinitions.js";
import { hashPlan } from "../../../packages/utils/src/hash.js";

const severityRank = (severity: "info" | "warn" | "fatal") => {
  if (severity === "fatal") {
    return 3;
  }
  if (severity === "warn") {
    return 2;
  }
  return 1;
};

export function checkInvariants(params: {
  recipe: Recipe;
  plan: ContextPlan;
  view: ViewDefinition;
}): InvariantReport {
  const { recipe, plan, view } = params;
  const violations: InvariantViolation[] = [];

  for (const invariant of invariantDefinitions) {
    const condition = invariant.condition;

    if (condition.type === "anchor_stability") {
      if (condition.viewIds.includes(recipe.viewId)) {
        const required = new Set(plan.stableAnchors.map((anchor) => anchor.id));
        const selected = new Set(plan.selectedSections
          .find((section) => section.id === "anchors")
          ?.items.map((item) => item.id) ?? []);
        const missing = [...required].filter((id) => !selected.has(id));
        if (missing.length > 0) {
          violations.push({
            invariantId: invariant.id,
            severity: invariant.severity,
            message: `Missing required anchors: ${missing.join(", ")}`
          });
        }
      }
    }

    if (condition.type === "token_budget") {
      if (plan.tokenReport.usedTotal > plan.tokenReport.budgetTotal) {
        violations.push({
          invariantId: invariant.id,
          severity: invariant.severity,
          message: `Token budget exceeded: ${plan.tokenReport.usedTotal}/${plan.tokenReport.budgetTotal}`
        });
      }
      for (const section of plan.selectedSections) {
        if (section.tokenEstimate > section.budget) {
          violations.push({
            invariantId: invariant.id,
            severity: invariant.severity,
            message: `Section ${section.id} over budget: ${section.tokenEstimate}/${section.budget}`
          });
        }
      }
    }

    if (condition.type === "view_policy_consistency") {
      if (!view.policy.runtime.allowRag && recipe.runtimePolicy.allowRag) {
        violations.push({
          invariantId: invariant.id,
          severity: invariant.severity,
          message: "RAG enabled while view disallows it"
        });
      }
      if (!view.policy.runtime.allowRag) {
        const ragItems = plan.selectedSections.find((section) => section.id === "rag")?.items ?? [];
        if (ragItems.length > 0) {
          violations.push({
            invariantId: invariant.id,
            severity: invariant.severity,
            message: "RAG items present while view disallows it"
          });
        }
      }
    }

    if (condition.type === "context_source_isolation") {
      if (condition.modes.includes(recipe.diagnostics?.mode ?? "normal")) {
        if (!recipe.diagnostics?.candidateSnapshotHash) {
          violations.push({
            invariantId: invariant.id,
            severity: invariant.severity,
            message: "Missing candidate snapshot hash for diagnostic mode"
          });
        }
        if (plan.inputsSnapshot.candidateHash && recipe.diagnostics?.candidateSnapshotHash) {
          if (plan.inputsSnapshot.candidateHash !== recipe.diagnostics.candidateSnapshotHash) {
            violations.push({
              invariantId: invariant.id,
              severity: invariant.severity,
              message: "Candidate snapshot hash mismatch"
            });
          }
        }
      }
    }

    if (condition.type === "planner_determinism") {
      if (recipe.diagnostics?.expectedPlanHash) {
        const planHash = hashPlan(plan);
        if (planHash !== recipe.diagnostics.expectedPlanHash) {
          violations.push({
            invariantId: invariant.id,
            severity: invariant.severity,
            message: "Planner hash mismatch under deterministic expectation",
            metadata: { expected: recipe.diagnostics.expectedPlanHash, actual: planHash }
          });
        }
      }
    }

    if (condition.type === "writeback_safety") {
      if (!recipe.runtimePolicy.allowMemoryWrite) {
        if (recipe.decisions.notes.some((note) => note.includes("memory_write"))) {
          violations.push({
            invariantId: invariant.id,
            severity: invariant.severity,
            message: "Memory write noted while policy disallows it"
          });
        }
      }
    }
  }

  const highest = violations.reduce<"info" | "warn" | "fatal">(
    (current, violation) =>
      severityRank(violation.severity) > severityRank(current) ? violation.severity : current,
    "info"
  );

  return {
    recipeId: recipe.id,
    planId: plan.planId,
    violations,
    highestSeverity: highest,
    pass: !violations.some((violation) => violation.severity === "fatal")
  };
}
