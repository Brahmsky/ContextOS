// Shared domain types for ContextOS.
// These are part of the cross-layer contracts described in the implementation architecture.

export type ContextItemType = "anchor" | "stream" | "island" | "memory" | "rag";

export interface ViewDefinition {
  id: string;
  version: string;
  label: string;
  description: string;
  prompt: string;
  policy: {
    context: {
      maxTokens: number;
      weights: {
        anchors: number;
        stream: number;
        islands: number;
        memory: number;
        rag: number;
      };
    };
    runtime: {
      temperature: number;
      allowTools: boolean;
      allowRag: boolean;
      allowMemoryWrite: boolean;
    };
  };
}

export interface ContextItem {
  id: string;
  type: ContextItemType;
  content: string;
  source: string;
  score?: number;
  tokens?: number;
}

export type DropReason =
  | "budget_exceeded"
  | "denied_by_policy"
  | "low_score"
  | "duplicate"
  | "invalid_source";

export type SelectionReason = string;

export interface DroppedItem {
  id: string;
  type: ContextItemType;
  source: string;
  score?: number;
  dropReason: DropReason;
  reasonNotes?: SelectionReason[];
}

export interface TokenReport {
  budgetTotal: number;
  usedTotal: number;
  byBucket: Record<string, { budget: number; used: number }>;
}

export interface ContextSelection {
  anchors: ContextItem[];
  stream: ContextItem[];
  islands: ContextItem[];
  memory: ContextItem[];
  rag: ContextItem[];
}

export interface ContextSection {
  id: string;
  label: string;
  items: ContextItem[];
  tokenEstimate: number;
  budget: number;
}

export interface ContextPlan {
  planId: string;
  requestId: string;
  plannerVersion: string;
  selectedSections: ContextSection[];
  stableAnchors: Anchor[];
  tokenReport: TokenReport;
  droppedItems: DroppedItem[];
  inputsSnapshot: {
    candidateCounts: Record<string, number>;
    weights: Record<string, number>;
    window: { streamRecent: number; streamMiddle: number };
    thresholds: { lowScore: number };
  };
}

export interface Island {
  id: string;
  title: string;
  summary: string;
  anchors: string[];
  driftScore: number;
  updatedAt: string;
}

export interface Anchor {
  id: string;
  label: string;
  content: string;
  scope: "global" | "view" | "island";
  updatedAt: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCallPlan {
  modelId: string;
  temperature: number;
  messages: ModelMessage[];
  tools: string[];
  kvPolicy: "default" | "cache" | "no_cache";
  safety: "standard" | "strict";
}

export interface Recipe {
  id: string;
  requestId: string;
  revision: number;
  parentRecipeId?: string;
  timestamp: string;
  viewId: string;
  viewVersion: string;
  viewWeights: ViewDefinition["policy"]["context"]["weights"];
  plannerVersion: string;
  contextPlanId: string;
  runtimePolicy: {
    temperature: number;
    allowTools: boolean;
    allowRag: boolean;
    allowMemoryWrite: boolean;
    kvPolicy: ModelCallPlan["kvPolicy"];
  };
  selectedContext: {
    anchors: ContextItem[];
    stream: ContextItem[];
    islands: ContextItem[];
    memory: ContextItem[];
    rag: ContextItem[];
  };
  tokenUsage: {
    budget: number;
    used: number;
  };
  modelPlan: ModelCallPlan;
  decisions: {
    notes: string[];
  };
}

export interface RecipeDiff {
  previousRecipeId: string;
  nextRecipeId: string;
  viewChange: {
    previous: { id: string; version: string; weights: ViewDefinition["policy"]["context"]["weights"] };
    next: { id: string; version: string; weights: ViewDefinition["policy"]["context"]["weights"] };
  };
  contextSelection: {
    addedIslands: string[];
    removedIslands: string[];
    addedAnchors: string[];
    removedAnchors: string[];
    streamWindowChange: {
      previousCount: number;
      nextCount: number;
    };
  };
  tokenReportChange: {
    previous: TokenReport;
    next: TokenReport;
  };
  droppedItemsChange: {
    added: DroppedItem[];
    removed: DroppedItem[];
  };
  runtimePolicyChange: {
    previous: Recipe["runtimePolicy"];
    next: Recipe["runtimePolicy"];
  };
}
