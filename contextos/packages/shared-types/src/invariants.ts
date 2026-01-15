export type InvariantScope = "view" | "planner" | "context" | "runtime";
export type InvariantSeverity = "info" | "warn" | "fatal";

export type InvariantCondition =
  | { type: "anchor_stability"; viewIds: string[] }
  | { type: "token_budget" }
  | { type: "view_policy_consistency" }
  | { type: "context_source_isolation"; modes: Array<"replay" | "compare"> }
  | { type: "planner_determinism" }
  | { type: "writeback_safety" };

export interface InvariantDefinition {
  id: string;
  description: string;
  scope: InvariantScope;
  appliesTo: {
    viewIds?: string[];
    plannerVariants?: string[];
    global?: boolean;
  };
  condition: InvariantCondition;
  severity: InvariantSeverity;
  remediationHint: string;
}

export interface InvariantViolation {
  invariantId: string;
  severity: InvariantSeverity;
  message: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface InvariantReport {
  recipeId: string;
  planId: string;
  violations: InvariantViolation[];
  highestSeverity: InvariantSeverity;
  pass: boolean;
}
