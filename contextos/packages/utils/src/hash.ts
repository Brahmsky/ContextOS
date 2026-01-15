import { createHash } from "node:crypto";
import type { ContextPlan, ModelCallPlan, ModelMessage } from "../../shared-types/src/types.js";

const normalizeNewlines = (value: string) => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const body = entries.map(([key, val]) => `"${key}":${stableStringify(val)}`).join(",");
    return `{${body}}`;
  }
  if (typeof value === "string") {
    return JSON.stringify(normalizeNewlines(value));
  }
  return JSON.stringify(value);
}

export function hashJson(value: unknown): string {
  const normalized = stableStringify(value);
  return createHash("sha256").update(normalized).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(normalizeNewlines(value)).digest("hex");
}

export function hashPromptMessages(messages: ModelMessage[]): string {
  const canonical = messages.map((msg) => ({
    role: msg.role,
    content: normalizeNewlines(msg.content),
    name: (msg as { name?: string }).name,
    tool_call_id: (msg as { tool_call_id?: string }).tool_call_id
  }));
  return hashJson(canonical);
}

export function hashPlan(plan: ContextPlan): string {
  const canonical = {
    plannerVersion: plan.plannerVersion,
    selectedSections: plan.selectedSections.map((section) => ({
      id: section.id,
      label: section.label,
      tokenEstimate: section.tokenEstimate,
      budget: section.budget,
      items: section.items.map((item) => ({
        id: item.id,
        type: item.type,
        content: normalizeNewlines(item.content),
        source: item.source,
        score: item.score,
        tokens: item.tokens
      }))
    })),
    stableAnchors: plan.stableAnchors.map((anchor) => ({
      id: anchor.id,
      label: normalizeNewlines(anchor.label),
      content: normalizeNewlines(anchor.content),
      scope: anchor.scope
    })),
    tokenReport: plan.tokenReport,
    droppedItems: plan.droppedItems.map((item) => ({
      id: item.id,
      type: item.type,
      source: item.source,
      score: item.score,
      dropReason: item.dropReason,
      reasonNotes: item.reasonNotes
    })),
    inputsSnapshot: {
      candidateCounts: plan.inputsSnapshot.candidateCounts,
      weights: plan.inputsSnapshot.weights,
      window: plan.inputsSnapshot.window,
      thresholds: plan.inputsSnapshot.thresholds
    }
  };
  return hashJson(canonical);
}

export function hashModelCallPlan(plan: ModelCallPlan): string {
  const canonical = {
    modelId: plan.modelId,
    temperature: plan.temperature,
    tools: plan.tools,
    kvPolicy: plan.kvPolicy,
    safety: plan.safety,
    promptHash: hashPromptMessages(plan.messages)
  };
  return hashJson(canonical);
}

export function hashResponseText(value: string): string {
  return hashText(value);
}
