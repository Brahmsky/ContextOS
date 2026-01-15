import { createServer } from "node:http";
import { parse } from "node:url";
import { readStore, readStoreById } from "../../../data-layer/src/jsonStore.js";
import type { CanvasBundle } from "../../../packages/shared-types/src/experiments.js";

const getBundle = async (rootDir: string, experimentId: string): Promise<CanvasBundle | undefined> => {
  const bundles = (await readStore(rootDir, "canvas_bundles")) as CanvasBundle[];
  return bundles.find((bundle) => bundle.experimentId === experimentId);
};

const getArtifact = async (rootDir: string, ref: string) => {
  const [kind, id] = ref.split(":");
  if (!kind || !id) {
    return undefined;
  }
  const storeMap: Record<string, Parameters<typeof readStoreById>[1]> = {
    plan: "experiment_plans",
    diff: "experiment_diffs",
    drift: "experiment_drifts",
    timeline: "experiment_timelines"
  };
  const store = storeMap[kind];
  if (!store) {
    return undefined;
  }
  return readStoreById(rootDir, store, id);
};

const rootDir = process.cwd();

createServer(async (req, res) => {
  const url = parse(req.url ?? "", true);
  const path = url.pathname ?? "/";

  if (path.startsWith("/experiments/") && path.endsWith("/bundle")) {
    const experimentId = path.split("/")[2];
    const bundle = await getBundle(rootDir, experimentId);
    if (!bundle) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bundle not found." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(bundle));
    return;
  }

  if (path.startsWith("/artifacts/")) {
    const ref = path.split("/")[2];
    const artifact = await getArtifact(rootDir, ref);
    if (!artifact) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Artifact not found." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(artifact));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found." }));
}).listen(3000);
