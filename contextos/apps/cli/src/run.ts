import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Orchestrator } from "../../../services/orchestrator/src/orchestrator.js";
import { loadViews } from "../../../services/orchestrator/src/viewLoader.js";
import { IntentEstimator } from "../../../services/logic-engine/src/estimator/intentEstimator.js";
import { ContextPlanner } from "../../../services/logic-engine/src/planner/contextPlanner.js";
import { WritebackController } from "../../../services/logic-engine/src/writeback/writebackController.js";
import { MockLLMAdapter } from "../../../adapters/llm/mockAdapter.js";
import { ContextPlansService } from "../../../services/domain-services/src/contextPlans/service.js";
import { RecipesService } from "../../../services/domain-services/src/recipes/service.js";
import { diffRecipes } from "../../../packages/shared-types/src/diff.js";
import { writeJsonFile } from "../../../packages/utils/src/files.js";
import { appendStore } from "../../../data-layer/src/jsonStore.js";
import { detectDrift } from "../../../services/logic-engine/drift/driftDetector.js";
import type { StrategyVariant } from "../../../packages/shared-types/src/comparison.js";
import { readStoreById } from "../../../data-layer/src/jsonStore.js";
import { runRegression } from "../../../services/logic-engine/regression/regressionRunner.js";
import { hashJson } from "../../../packages/utils/src/hash.js";
import { OfflineAnalyzer } from "../../../services/analysis/offlineAnalyzer.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const orchestrator = new Orchestrator(
  rootDir,
  new IntentEstimator(),
  new ContextPlanner(),
  new MockLLMAdapter(),
  new WritebackController(rootDir)
);

const args = process.argv.slice(2);
const command = args[0] ?? "run";

const parseArgs = (input: string[]) => {
  const options: {
    message?: string;
    view?: string;
    excludeIslands: string[];
    timeline?: boolean;
    variants?: string;
  } = { excludeIslands: [] };
  for (let i = 0; i < input.length; i += 1) {
    const arg = input[i];
    if (arg === "--message") {
      options.message = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--view") {
      options.view = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--exclude-island") {
      const value = input[i + 1];
      if (value) {
        options.excludeIslands.push(value);
      }
      i += 1;
      continue;
    }
    if (arg === "--timeline") {
      options.timeline = true;
      continue;
    }
    if (arg === "--variants") {
      options.variants = input[i + 1];
      i += 1;
    }
  }
  return options;
};

if (command === "replay") {
  const recipeId = args[1];
  if (!recipeId) {
    throw new Error("Usage: replay <recipeId>");
  }
  const first = await orchestrator.replayTurn(recipeId);
  const second = await orchestrator.replayTurn(recipeId);
  const consistent = first.planHash === second.planHash && first.promptHash === second.promptHash;
  if (!consistent) {
    console.error("Replay mismatch detected.", { first: first.planHash, second: second.planHash });
    process.exit(1);
  }
  console.log("Replay Summary");
  console.log(`- planHash: ${first.planHash}`);
  console.log(`- promptHash: ${first.promptHash}`);
  console.log("- consistent: true");
  process.exit(0);
}

if (command === "drift") {
  const fromId = args[1];
  const toId = args[2];
  if (!fromId || !toId) {
    throw new Error("Usage: drift <fromRecipeId> <toRecipeId>");
  }
  const recipesService = new RecipesService(rootDir);
  const plansService = new ContextPlansService(rootDir);
  const fromRecipe = await recipesService.findById(fromId);
  const toRecipe = await recipesService.findById(toId);
  if (!fromRecipe || !toRecipe) {
    throw new Error("Missing recipe(s) for drift.");
  }
  const fromPlan = await plansService.findById(fromRecipe.contextPlanId);
  const toPlan = await plansService.findById(toRecipe.contextPlanId);
  if (!fromPlan || !toPlan) {
    throw new Error("Missing plan(s) for drift.");
  }
  const driftReport = detectDrift({
    referenceRecipe: fromRecipe,
    currentRecipe: toRecipe,
    referencePlan: fromPlan,
    currentPlan: toPlan
  });
  await writeJsonFile(`${rootDir}/data/drift_reports/drift-${toRecipe.id}.json`, driftReport);
  await appendStore(rootDir, "drift_reports", driftReport);
  console.log("Drift Summary");
  console.log(`- signals: ${driftReport.driftSignals.length}`);
  console.log(`- suspected layers: ${driftReport.suspectedLayers.join(", ") || "none"}`);
  process.exit(0);
}

if (command === "compare") {
  const options = parseArgs(args);
  if (!options.message || !options.variants) {
    throw new Error("Usage: compare --message \"...\" --variants viewA,viewB");
  }
  const variants: StrategyVariant[] = options.variants.split(",").map((viewId) => ({
    plannerVariantId: "v1",
    viewVariantId: viewId.trim(),
    description: `compare:${viewId.trim()}`
  }));
  const report = await orchestrator.compareStrategies({
    message: options.message,
    variants
  });
  await writeJsonFile(`${rootDir}/data/comparison_reports/comparison-${randomUUID()}.json`, report);
  await appendStore(rootDir, "comparison_reports", report);
  console.log("Comparison Summary");
  console.log(`- variants: ${report.variants.length}`);
  console.log(`- pairwise: ${report.pairwiseDiffs.length}`);
  process.exit(0);
}

if (command === "regress") {
  const baselineId = args[1];
  const candidateId = args[2];
  if (!baselineId || !candidateId) {
    throw new Error("Usage: regress <baselineRecipeId> <candidateRecipeId>");
  }
  const recipesService = new RecipesService(rootDir);
  const plansService = new ContextPlansService(rootDir);
  const baselineRecipe = await recipesService.findById(baselineId);
  const candidateRecipe = await recipesService.findById(candidateId);
  if (!baselineRecipe || !candidateRecipe) {
    throw new Error("Missing recipe(s) for regression.");
  }
  const baselinePlan = await plansService.findById(baselineRecipe.contextPlanId);
  const candidatePlan = await plansService.findById(candidateRecipe.contextPlanId);
  if (!baselinePlan || !candidatePlan) {
    throw new Error("Missing plan(s) for regression.");
  }
  const profile = {
    baselineRecipeId: baselineRecipe.id,
    baselinePlanHash: hashJson(baselinePlan),
    invariantsExpectedPass: [],
    driftThresholds: {
      islandShift: 0.3,
      tokenDistributionShift: 0.2,
      anchorLoss: 0.2
    },
    description: "default regression profile"
  };
  const views = await loadViews(rootDir);
  const viewLookup = (viewId: string) => views.find((view) => view.id === viewId) ?? views[0];
  const { report } = runRegression({
    baselineRecipe,
    candidateRecipe,
    baselinePlan,
    candidatePlan,
    profile,
    viewLookup
  });
  await writeJsonFile(`${rootDir}/data/regression_reports/regression-${candidateRecipe.id}.json`, report);
  await appendStore(rootDir, "regression_reports", report);
  console.log("Regression Summary");
  console.log(`- pass: ${report.pass}`);
  console.log(`- reasons: ${report.reasons.join("; ") || "none"}`);
  process.exit(0);
}

if (command === "recommend") {
  const options = parseArgs(args);
  const analyzer = new OfflineAnalyzer(rootDir);
  if (options.view) {
    const report = await analyzer.recommend({ scope: "view", viewId: options.view, limit: 3 });
    await writeJsonFile(`${rootDir}/data/recommendation_reports/recommend-${options.view}.json`, report);
    await appendStore(rootDir, "recommendation_reports", report);
    console.log("Recommendation Summary");
    console.log(`- scope: view:${options.view}`);
    console.log(`- recommended: ${report.recommendedStrategies.length}`);
    console.log(`- rejected: ${report.rejectedStrategies.length}`);
    process.exit(0);
  }
  const report = await analyzer.recommend({ scope: "global", limit: 3 });
  await writeJsonFile(`${rootDir}/data/recommendation_reports/recommend-global.json`, report);
  await appendStore(rootDir, "recommendation_reports", report);
  console.log("Recommendation Summary");
  console.log("- scope: global");
  console.log(`- recommended: ${report.recommendedStrategies.length}`);
  console.log(`- rejected: ${report.rejectedStrategies.length}`);
  process.exit(0);
}

if (command === "timeline") {
  const recipeId = args[1];
  if (!recipeId) {
    throw new Error("Usage: timeline <recipeId>");
  }
  const timeline = await readStoreById(rootDir, "timelines", recipeId);
  if (!timeline) {
    throw new Error("Timeline not found.");
  }
  console.log("Timeline Summary");
  const steps = (timeline as { steps?: Array<{ stepName: string; startTs: number; endTs: number }> }).steps ?? [];
  steps.forEach((step) => {
    const duration = step.endTs - step.startTs;
    console.log(`- ${step.stepName}: ${duration}ms`);
  });
  await writeJsonFile(`${rootDir}/data/timelines/timeline-${recipeId}.json`, timeline);
  process.exit(0);
}

const options = parseArgs(args);
const message = options.message ?? "Hello ContextOS";
const requestId = randomUUID();

const baseResponse = await orchestrator.handleTurn({
  userId: "local",
  threadId: "demo",
  message,
  requestId,
  revision: 1,
  diagnostics: { timeline: options.timeline }
});

if (options.view || options.excludeIslands.length > 0) {
  const overrideResponse = await orchestrator.handleTurn({
    userId: "local",
    threadId: "demo",
    message,
    requestId,
    revision: 2,
    parentRecipeId: baseResponse.recipe.id,
    overrides: {
      viewId: options.view,
      excludeIslands: options.excludeIslands
    }
  });

  const plansService = new ContextPlansService(rootDir);
  const prevPlan = await plansService.findById(baseResponse.recipe.contextPlanId);
  const nextPlan = await plansService.findById(overrideResponse.recipe.contextPlanId);
  if (!prevPlan || !nextPlan) {
    throw new Error("Missing context plan(s) for diff.");
  }

  const diff = diffRecipes(baseResponse.recipe, overrideResponse.recipe, prevPlan, nextPlan);
  await writeJsonFile(`${rootDir}/data/recipes/recipe_diff.json`, diff);
  await writeJsonFile(`${rootDir}/data/recipes/recipe_diff-${overrideResponse.recipe.id}.json`, diff);
  await appendStore(rootDir, "recipe_diffs", diff);

  console.log("Recipe Diff Summary");
  console.log(`- view: ${diff.viewChange.previous.id} -> ${diff.viewChange.next.id}`);
  console.log(`- islands added: ${diff.contextSelection.addedIslands.length}`);
  console.log(`- islands removed: ${diff.contextSelection.removedIslands.length}`);
  console.log(`- dropped added: ${diff.droppedItemsChange.added.length}`);
  console.log(`- dropped removed: ${diff.droppedItemsChange.removed.length}`);
} else {
  console.log("Assistant:", baseResponse.assistantMessage);
}
