import { appendStore, readStore } from "../../data-layer/src/jsonStore.js";
import { writeJsonFile } from "../../packages/utils/src/files.js";
import { hashJson } from "../../packages/utils/src/hash.js";
import type { StrategyKey } from "../../packages/shared-types/src/strategyMetrics.js";
import type { Recipe, ViewDefinition } from "../../packages/shared-types/src/types.js";
import type { PolicyAdoption } from "../../packages/shared-types/src/adoption.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertValidViewDefinition } from "../../packages/shared-types/src/schemas.js";

const parseVersion = (version: string) => version.split(".").map((part) => Number(part));

const bumpPatch = (version: string) => {
  const [major = 0, minor = 0, patch = 0] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
};

export class PolicyApplier {
  constructor(private readonly rootDir: string) {}

  async applyViewStrategy(params: {
    adoption: PolicyAdoption;
    strategyKey: StrategyKey;
  }): Promise<{ view: ViewDefinition; appliedChanges: Record<string, unknown>; previousVersion: string }> {
    const recipes = (await readStore(this.rootDir, "recipes")) as Recipe[];
    const matchingRecipe = recipes
      .filter((recipe) => recipe.viewId === params.strategyKey.viewId)
      .find((recipe) => {
        const policySignature = hashJson({
          viewWeights: recipe.viewWeights,
          runtimePolicy: recipe.runtimePolicy
        });
        return (
          recipe.plannerVersion === params.strategyKey.plannerVariant &&
          policySignature === params.strategyKey.policySignature
        );
      });

    if (!matchingRecipe) {
      throw new Error("No matching recipe found for strategy key.");
    }

    const views = await this.loadAllViews();
    const currentView = views
      .filter((view) => view.id === matchingRecipe.viewId)
      .sort((a, b) => {
        const [aMajor = 0, aMinor = 0, aPatch = 0] = parseVersion(a.version);
        const [bMajor = 0, bMinor = 0, bPatch = 0] = parseVersion(b.version);
        if (aMajor !== bMajor) return bMajor - aMajor;
        if (aMinor !== bMinor) return bMinor - aMinor;
        return bPatch - aPatch;
      })[0];
    if (!currentView) {
      throw new Error("Base view not found for adoption.");
    }
    const currentVersion = currentView.version;
    const freeze = currentView.freeze;
    if (freeze?.planner && JSON.stringify(currentView.policy.context.weights) !== JSON.stringify(matchingRecipe.viewWeights)) {
      throw new Error("Planner weights override denied by freeze.");
    }
    if (freeze?.runtime?.includes("rag") && currentView.policy.runtime.allowRag !== matchingRecipe.runtimePolicy.allowRag) {
      throw new Error("Runtime override denied by freeze (rag).");
    }
    const systemMessage = matchingRecipe.modelPlan.messages.find((msg) => msg.role === "system");

    const nextVersion = bumpPatch(currentVersion);
    const newView: ViewDefinition = {
      id: matchingRecipe.viewId,
      version: nextVersion,
      label: matchingRecipe.viewId,
      description: `Adopted strategy ${params.strategyKey.policySignature}`,
      prompt: systemMessage?.content ?? "",
      policy: {
        context: {
          maxTokens: matchingRecipe.tokenUsage.budget,
          weights: matchingRecipe.viewWeights
        },
        runtime: {
          temperature: matchingRecipe.runtimePolicy.temperature,
          allowTools: matchingRecipe.runtimePolicy.allowTools,
          allowRag: matchingRecipe.runtimePolicy.allowRag,
          allowMemoryWrite: matchingRecipe.runtimePolicy.allowMemoryWrite
        }
      }
    };

    await appendStore(this.rootDir, "adopted_views", newView);
    await writeJsonFile(`${this.rootDir}/data/views/adopted-${newView.id}-${newView.version}.json`, newView);

    return {
      view: newView,
      appliedChanges: {
        viewId: newView.id,
        fromVersion: currentVersion,
        toVersion: newView.version,
        policySignature: params.strategyKey.policySignature
      },
      previousVersion: currentVersion
    };
  }

  async rollbackView(params: { viewId: string; targetVersion: string }): Promise<ViewDefinition> {
    const views = await this.loadAllViews();
    const target = views.find((view) => view.id === params.viewId && view.version === params.targetVersion);
    if (!target) {
      throw new Error("Target view version not found for rollback.");
    }
    const nextVersion = bumpPatch(target.version);
    const rollbackView: ViewDefinition = { ...target, version: nextVersion };
    await appendStore(this.rootDir, "adopted_views", rollbackView);
    await writeJsonFile(`${this.rootDir}/data/views/adopted-${rollbackView.id}-${rollbackView.version}.json`, rollbackView);
    return rollbackView;
  }

  private async loadAllViews(): Promise<ViewDefinition[]> {
    const path = resolve(this.rootDir, "docs/default-views/index.json");
    const raw = await readFile(path, "utf-8");
    const payload = JSON.parse(raw) as { views: ViewDefinition[] };
    const adoptedViews = (await readStore(this.rootDir, "adopted_views")) as ViewDefinition[];
    return [...payload.views, ...adoptedViews].map(assertValidViewDefinition);
  }
}
