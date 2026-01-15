import type {
  Anchor,
  ContextItem,
  Island,
  ModelCallPlan,
  Recipe,
  ContextPlan,
  ViewDefinition,
} from "./types.js";

export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "boolean";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  additionalProperties?: boolean;
};

export const viewDefinitionSchema: JsonSchema = {
  type: "object",
  required: ["id", "version", "label", "description", "prompt", "policy"],
  properties: {
    id: { type: "string" },
    version: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
    prompt: { type: "string" },
    freeze: {
      type: "object",
      properties: {
        planner: { type: "boolean" },
        contextSources: { type: "array", items: { type: "string" } },
        runtime: { type: "array", items: { type: "string" } }
      }
    },
    policy: {
      type: "object",
      required: ["context", "runtime"],
      properties: {
        context: {
          type: "object",
          required: ["maxTokens", "weights"],
          properties: {
            maxTokens: { type: "number" },
            weights: {
              type: "object",
              required: ["anchors", "stream", "islands", "memory", "rag"],
              properties: {
                anchors: { type: "number" },
                stream: { type: "number" },
                islands: { type: "number" },
                memory: { type: "number" },
                rag: { type: "number" }
              }
            }
          }
        },
        runtime: {
          type: "object",
          required: ["temperature", "allowTools", "allowRag", "allowMemoryWrite"],
          properties: {
            temperature: { type: "number" },
            allowTools: { type: "boolean" },
            allowRag: { type: "boolean" },
            allowMemoryWrite: { type: "boolean" }
          }
        }
      }
    }
  },
  additionalProperties: false
};

export const contextItemSchema: JsonSchema = {
  type: "object",
  required: ["id", "type", "content", "source"],
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    content: { type: "string" },
    source: { type: "string" },
    score: { type: "number" },
    tokens: { type: "number" }
  },
  additionalProperties: false
};

export const droppedItemSchema: JsonSchema = {
  type: "object",
  required: ["id", "type", "source", "dropReason"],
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    source: { type: "string" },
    score: { type: "number" },
    dropReason: { type: "string" },
    reasonNotes: { type: "array", items: { type: "string" } }
  },
  additionalProperties: false
};

export const tokenReportSchema: JsonSchema = {
  type: "object",
  required: ["budgetTotal", "usedTotal", "byBucket"],
  properties: {
    budgetTotal: { type: "number" },
    usedTotal: { type: "number" },
    byBucket: {
      type: "object",
      properties: {}
    }
  },
  additionalProperties: true
};

export const contextSectionSchema: JsonSchema = {
  type: "object",
  required: ["id", "label", "items", "tokenEstimate", "budget"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    items: { type: "array", items: contextItemSchema },
    tokenEstimate: { type: "number" },
    budget: { type: "number" }
  },
  additionalProperties: false
};

export const anchorSchema: JsonSchema = {
  type: "object",
  required: ["id", "label", "content", "scope", "updatedAt"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    content: { type: "string" },
    scope: { type: "string" },
    updatedAt: { type: "string" }
  },
  additionalProperties: false
};

export const contextPlanSchema: JsonSchema = {
  type: "object",
  required: [
    "planId",
    "requestId",
    "plannerVersion",
    "selectedSections",
    "stableAnchors",
    "tokenReport",
    "droppedItems",
    "inputsSnapshot"
  ],
  properties: {
    planId: { type: "string" },
    requestId: { type: "string" },
    plannerVersion: { type: "string" },
    selectedSections: { type: "array", items: contextSectionSchema },
    stableAnchors: { type: "array", items: anchorSchema },
    tokenReport: tokenReportSchema,
    droppedItems: { type: "array", items: droppedItemSchema },
    inputsSnapshot: {
      type: "object",
      required: ["candidateCounts", "weights", "window", "thresholds"],
      properties: {
        candidateCounts: { type: "object" },
        weights: { type: "object" },
        window: { type: "object" },
        thresholds: { type: "object" },
        candidateHash: { type: "string" }
      }
    }
  },
  additionalProperties: false
};
export const islandSchema: JsonSchema = {
  type: "object",
  required: ["id", "title", "summary", "anchors", "driftScore", "updatedAt"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    anchors: { type: "array", items: { type: "string" } },
    driftScore: { type: "number" },
    updatedAt: { type: "string" }
  },
  additionalProperties: false
};

export const modelCallPlanSchema: JsonSchema = {
  type: "object",
  required: ["modelId", "temperature", "messages", "tools", "kvPolicy", "safety"],
  properties: {
    modelId: { type: "string" },
    temperature: { type: "number" },
    messages: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string" },
          content: { type: "string" }
        },
        additionalProperties: false
      }
    },
    tools: { type: "array", items: { type: "string" } },
    kvPolicy: { type: "string" },
    safety: { type: "string" }
  },
  additionalProperties: false
};

export const recipeSchema: JsonSchema = {
  type: "object",
  required: [
    "id",
    "requestId",
    "revision",
    "timestamp",
    "viewId",
    "viewVersion",
    "viewWeights",
    "plannerVersion",
    "contextPlanId",
    "runtimePolicy",
    "selectedContext",
    "tokenUsage",
    "modelPlan",
    "decisions"
  ],
  properties: {
    id: { type: "string" },
    requestId: { type: "string" },
    revision: { type: "number" },
    parentRecipeId: { type: "string" },
    timestamp: { type: "string" },
    viewId: { type: "string" },
    viewVersion: { type: "string" },
    viewWeights: { type: "object" },
    plannerVersion: { type: "string" },
    contextPlanId: { type: "string" },
    runtimePolicy: {
      type: "object",
      required: ["temperature", "allowTools", "allowRag", "allowMemoryWrite", "kvPolicy"],
      properties: {
        temperature: { type: "number" },
        allowTools: { type: "boolean" },
        allowRag: { type: "boolean" },
        allowMemoryWrite: { type: "boolean" },
        kvPolicy: { type: "string" }
      }
    },
    selectedContext: {
      type: "object",
      required: ["anchors", "stream", "islands", "memory", "rag"],
      properties: {
        anchors: { type: "array", items: contextItemSchema },
        stream: { type: "array", items: contextItemSchema },
        islands: { type: "array", items: contextItemSchema },
        memory: { type: "array", items: contextItemSchema },
        rag: { type: "array", items: contextItemSchema }
      }
    },
    tokenUsage: {
      type: "object",
      required: ["budget", "used"],
      properties: {
        budget: { type: "number" },
        used: { type: "number" }
      }
    },
    modelPlan: modelCallPlanSchema,
    decisions: {
      type: "object",
      required: ["notes"],
      properties: {
        notes: { type: "array", items: { type: "string" } }
      }
    },
    diagnostics: {
      type: "object",
      properties: {
        mode: { type: "string" },
        candidateSnapshotHash: { type: "string" },
        expectedPlanHash: { type: "string" },
        overrideDenied: { type: "array", items: { type: "string" } }
      }
    }
  },
  additionalProperties: false
};

export function validateAgainstSchema<T>(schema: JsonSchema, value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const visit = (schemaNode: JsonSchema, node: unknown, path: string) => {
    if (schemaNode.type === "object") {
      if (typeof node !== "object" || node === null || Array.isArray(node)) {
        errors.push(`${path} should be object`);
        return;
      }
      const record = node as Record<string, unknown>;
      if (schemaNode.required) {
        for (const key of schemaNode.required) {
          if (!(key in record)) {
            errors.push(`${path}.${key} is required`);
          }
        }
      }
      if (schemaNode.properties) {
        for (const [key, childSchema] of Object.entries(schemaNode.properties)) {
          if (key in record) {
            visit(childSchema, record[key], `${path}.${key}`);
          }
        }
      }
      if (schemaNode.additionalProperties === false && schemaNode.properties) {
        for (const key of Object.keys(record)) {
          if (!(key in schemaNode.properties)) {
            errors.push(`${path}.${key} is not allowed`);
          }
        }
      }
      return;
    }

    if (schemaNode.type === "array") {
      if (!Array.isArray(node)) {
        errors.push(`${path} should be array`);
        return;
      }
      if (schemaNode.items) {
        node.forEach((item, index) => visit(schemaNode.items as JsonSchema, item, `${path}[${index}]`));
      }
      return;
    }

    if (schemaNode.type === "string") {
      if (typeof node !== "string") {
        errors.push(`${path} should be string`);
        return;
      }
      if (schemaNode.enum && !schemaNode.enum.includes(node)) {
        errors.push(`${path} should be one of ${schemaNode.enum.join(", ")}`);
      }
      return;
    }

    if (schemaNode.type === "number") {
      if (typeof node !== "number" || Number.isNaN(node)) {
        errors.push(`${path} should be number`);
      }
      return;
    }

    if (schemaNode.type === "boolean") {
      if (typeof node !== "boolean") {
        errors.push(`${path} should be boolean`);
      }
    }
  };

  visit(schema, value, "$");
  return { valid: errors.length === 0, errors };
}

export function assertValidViewDefinition(candidate: unknown): ViewDefinition {
  const result = validateAgainstSchema(viewDefinitionSchema, candidate);
  if (!result.valid) {
    throw new Error(`ViewDefinition schema validation failed: ${result.errors.join("; ")}`);
  }
  return candidate as ViewDefinition;
}

export function assertValidRecipe(candidate: unknown): Recipe {
  const result = validateAgainstSchema(recipeSchema, candidate);
  if (!result.valid) {
    throw new Error(`Recipe schema validation failed: ${result.errors.join("; ")}`);
  }
  return candidate as Recipe;
}

export function assertValidContextPlan(candidate: unknown): ContextPlan {
  const result = validateAgainstSchema(contextPlanSchema, candidate);
  if (!result.valid) {
    throw new Error(`ContextPlan schema validation failed: ${result.errors.join("; ")}`);
  }
  return candidate as ContextPlan;
}

export function assertValidContextItem(candidate: unknown): ContextItem {
  const result = validateAgainstSchema(contextItemSchema, candidate);
  if (!result.valid) {
    throw new Error(`ContextItem schema validation failed: ${result.errors.join("; ")}`);
  }
  return candidate as ContextItem;
}

export function assertValidIsland(candidate: unknown): Island {
  const result = validateAgainstSchema(islandSchema, candidate);
  if (!result.valid) {
    throw new Error(`Island schema validation failed: ${result.errors.join("; ")}`);
  }
  return candidate as Island;
}

export function assertValidAnchor(candidate: unknown): Anchor {
  const result = validateAgainstSchema(anchorSchema, candidate);
  if (!result.valid) {
    throw new Error(`Anchor schema validation failed: ${result.errors.join("; ")}`);
  }
  return candidate as Anchor;
}

export function assertValidModelCallPlan(candidate: unknown): ModelCallPlan {
  const result = validateAgainstSchema(modelCallPlanSchema, candidate);
  if (!result.valid) {
    throw new Error(`ModelCallPlan schema validation failed: ${result.errors.join("; ")}`);
  }
  return candidate as ModelCallPlan;
}
