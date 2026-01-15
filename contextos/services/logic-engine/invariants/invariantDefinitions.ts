import type { InvariantDefinition } from "../../../packages/shared-types/src/invariants.js";

export const invariantDefinitions: InvariantDefinition[] = [
  {
    id: "anchor-stability",
    description: "Required anchors must remain present in selected context for critical views.",
    scope: "context",
    appliesTo: { viewIds: ["debug", "plan"], global: false },
    condition: { type: "anchor_stability", viewIds: ["debug", "plan"] },
    severity: "fatal",
    remediationHint: "Ensure required anchors are pinned or widen anchor budget."
  },
  {
    id: "token-budget",
    description: "Token usage must not exceed budgets (overall or per-section).",
    scope: "planner",
    appliesTo: { global: true },
    condition: { type: "token_budget" },
    severity: "fatal",
    remediationHint: "Adjust planner weights or reduce candidate count."
  },
  {
    id: "view-policy-consistency",
    description: "Runtime policy must respect view policy (e.g., rag disabled means no rag).",
    scope: "runtime",
    appliesTo: { global: true },
    condition: { type: "view_policy_consistency" },
    severity: "fatal",
    remediationHint: "Ensure runtime flags align with view policy."
  },
  {
    id: "context-source-isolation",
    description: "Replay/compare must use fixed candidate pools (no implicit recall).",
    scope: "context",
    appliesTo: { global: true },
    condition: { type: "context_source_isolation", modes: ["replay", "compare"] },
    severity: "warn",
    remediationHint: "Reuse stored candidate snapshot for diagnostics."
  },
  {
    id: "planner-determinism",
    description: "Planner output should be deterministic under same inputs.",
    scope: "planner",
    appliesTo: { global: true },
    condition: { type: "planner_determinism" },
    severity: "warn",
    remediationHint: "Eliminate nondeterministic ordering in planner."
  },
  {
    id: "writeback-safety",
    description: "Memory write should not occur when view disallows it.",
    scope: "runtime",
    appliesTo: { global: true },
    condition: { type: "writeback_safety" },
    severity: "fatal",
    remediationHint: "Disable memory writeback or update view policy."
  }
];
