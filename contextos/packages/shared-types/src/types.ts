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
  timestamp: string;
  viewId: string;
  viewVersion: string;
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
