import { createHash } from "node:crypto";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const body = entries.map(([key, val]) => `"${key}":${stableStringify(val)}`).join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

export function hashJson(value: unknown): string {
  const normalized = stableStringify(value);
  return createHash("sha256").update(normalized).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
