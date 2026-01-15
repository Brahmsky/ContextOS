import type { ContextItem, ModelMessage, ViewDefinition } from "../../../packages/shared-types/src/types.js";

function section(title: string, items: ContextItem[]): string {
  if (items.length === 0) {
    return `${title}: (none)`;
  }
  const body = items.map((item) => `- ${item.content}`).join("\n");
  return `${title}:\n${body}`;
}

export function buildPrompt(params: {
  view: ViewDefinition;
  anchors: ContextItem[];
  stream: ContextItem[];
  islands: ContextItem[];
  memory: ContextItem[];
  rag: ContextItem[];
  userMessage: string;
}): ModelMessage[] {
  const { view, anchors, stream, islands, memory, rag, userMessage } = params;

  // Whitepaper: prompt is a field within the View, not the whole strategy.
  const system = [
    `View: ${view.label} (${view.id}@${view.version})`,
    view.prompt,
    section("Anchors", anchors),
    section("Stream", stream),
    section("Islands", islands),
    section("Memory", memory),
    section("RAG", rag)
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: userMessage }
  ];
}
