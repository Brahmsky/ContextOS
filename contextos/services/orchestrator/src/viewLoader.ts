import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertValidViewDefinition } from "../../../packages/shared-types/src/schemas.js";
import type { ViewDefinition } from "../../../packages/shared-types/src/types.js";

export async function loadViews(rootDir: string): Promise<ViewDefinition[]> {
  const path = resolve(rootDir, "docs/default-views/index.json");
  const raw = await readFile(path, "utf-8");
  const payload = JSON.parse(raw) as { views: ViewDefinition[] };
  return payload.views.map(assertValidViewDefinition);
}
