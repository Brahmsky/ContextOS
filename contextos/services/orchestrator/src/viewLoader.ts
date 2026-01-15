import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertValidViewDefinition } from "../../../packages/shared-types/src/schemas.js";
import type { ViewDefinition } from "../../../packages/shared-types/src/types.js";
import { readStore } from "../../../data-layer/src/jsonStore.js";

const parseVersion = (version: string) => version.split(".").map((part) => Number(part));

const sortViews = (views: ViewDefinition[]) => {
  const grouped = new Map<string, ViewDefinition[]>();
  views.forEach((view) => {
    const list = grouped.get(view.id) ?? [];
    list.push(view);
    grouped.set(view.id, list);
  });
  const sorted: ViewDefinition[] = [];
  grouped.forEach((list) => {
    list.sort((a, b) => {
      const [aMajor = 0, aMinor = 0, aPatch = 0] = parseVersion(a.version);
      const [bMajor = 0, bMinor = 0, bPatch = 0] = parseVersion(b.version);
      if (aMajor !== bMajor) return bMajor - aMajor;
      if (aMinor !== bMinor) return bMinor - aMinor;
      return bPatch - aPatch;
    });
    sorted.push(...list);
  });
  return sorted;
};

export async function loadViews(rootDir: string): Promise<ViewDefinition[]> {
  const path = resolve(rootDir, "docs/default-views/index.json");
  const raw = await readFile(path, "utf-8");
  const payload = JSON.parse(raw) as { views: ViewDefinition[] };
  const adoptedViews = (await readStore(rootDir, "adopted_views")) as ViewDefinition[];
  const merged = [...payload.views, ...adoptedViews].map(assertValidViewDefinition);
  return sortViews(merged);
}
