import type { Anchor, ContextItem } from "./types.js";

export type ExperimentIsolationLevel = "sandbox";
export type CompositionMode = "multi_view" | "view_blend" | "context_paint";

export interface ExperimentSpecView {
  viewId: string;
  version: string;
  weightOverride?: number;
}

export interface ExperimentSpec {
  specId: string;
  message: string;
  candidatePoolSnapshotRef: string;
  compositionMode: CompositionMode;
  views: ExperimentSpecView[];
  plannerVariants: string[];
  contextOverrides?: {
    includeIslands?: string[];
    excludeIslands?: string[];
    includeAnchors?: string[];
    excludeAnchors?: string[];
  };
  isolationLevel: ExperimentIsolationLevel;
  forbidWriteback: true;
  createdAt: string;
}

export interface CandidatePoolSnapshot {
  snapshotId: string;
  createdAt: string;
  anchors: ContextItem[];
  stableAnchors: Anchor[];
  stream: ContextItem[];
  islands: ContextItem[];
  memory: ContextItem[];
  rag: ContextItem[];
  stats: {
    anchors: number;
    stream: number;
    islands: number;
    memory: number;
    rag: number;
  };
}

export interface CompositionRun {
  runId: string;
  experimentId: string;
  specId: string;
  variantId: string;
  planRef?: string;
  diffRef?: string;
  driftRef?: string;
  timelineRef?: string;
  promptHash?: string;
  planHash?: string;
  metricsSummary: {
    tokenDistribution: Record<string, number>;
    anchorRetention: number;
    driftMagnitude: number;
  };
  status: "completed" | "failed";
}

export interface CanvasBundleNode {
  id: string;
  type: "view" | "plan" | "diff" | "drift" | "timeline";
  label: string;
  ref?: string;
  meta?: Record<string, unknown>;
}

export interface CanvasBundleEdge {
  id: string;
  source: string;
  target: string;
  type: "influences" | "compares" | "derives";
}

export interface CanvasBundle {
  bundleSchemaVersion: string;
  bundleId: string;
  experimentId: string;
  nodes: CanvasBundleNode[];
  edges: CanvasBundleEdge[];
  layoutHints: {
    groups: Array<{ id: string; label: string; nodeIds: string[] }>;
  };
  inspectors: Record<string, string[]>;
  artifactsIndex: Array<{
    ref: string;
    type: string;
    store: string;
  }>;
}
