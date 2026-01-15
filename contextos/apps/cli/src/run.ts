import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Orchestrator } from "../../../services/orchestrator/src/orchestrator.js";
import { IntentEstimator } from "../../../services/logic-engine/src/estimator/intentEstimator.js";
import { ContextPlanner } from "../../../services/logic-engine/src/planner/contextPlanner.js";
import { WritebackController } from "../../../services/logic-engine/src/writeback/writebackController.js";
import { MockLLMAdapter } from "../../../adapters/llm/mockAdapter.js";
import { ContextPlansService } from "../../../services/domain-services/src/contextPlans/service.js";
import { diffRecipes } from "../../../packages/shared-types/src/diff.js";
import { writeJsonFile } from "../../../packages/utils/src/files.js";
import { appendStore } from "../../../data-layer/src/jsonStore.js";

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

const options = parseArgs(args);
const message = options.message ?? "Hello ContextOS";
const requestId = randomUUID();

const baseResponse = await orchestrator.handleTurn({
  userId: "local",
  threadId: "demo",
  message,
  requestId,
  revision: 1
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
