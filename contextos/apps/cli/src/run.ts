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
import { readStoreById } from "../../../data-layer/src/jsonStore.js";
import { runRegression } from "../../../services/logic-engine/regression/regressionRunner.js";
import { hashJson } from "../../../packages/utils/src/hash.js";
import { OfflineAnalyzer } from "../../../services/analysis/offlineAnalyzer.js";
import { AdoptionService } from "../../../services/policy/adoptionService.js";
import { PolicyApplier } from "../../../services/policy/policyApplier.js";
import { RollbackService } from "../../../services/policy/rollbackService.js";
import type { StrategyKey } from "../../../packages/shared-types/src/strategyMetrics.js";
import { GovernanceAnalyzer } from "../../../services/governance/governanceAnalyzer.js";
import { GovernancePolicyService } from "../../../services/governance/governancePolicy.js";
import { ExperimentService } from "../../../services/experiments/experimentService.js";
import { ExperimentRunner } from "../../../services/experiments/experimentRunner.js";
import type { StrategyVariant } from "../../../packages/shared-types/src/comparison.js";

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
    description?: string;
    views?: string;
    isolation?: string;
    confirm?: boolean;
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
      continue;
    }
    if (arg === "--description") {
      options.description = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--views") {
      options.views = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--isolation") {
      options.isolation = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--confirm") {
      options.confirm = true;
    }
  }
  return options;
};

const parseStrategyKey = (value: string): StrategyKey => {
  const [viewId, plannerVariant, policySignature] = value.split(":");
  if (!viewId || !plannerVariant || !policySignature) {
    throw new Error("Strategy key must be formatted as viewId:plannerVariant:policySignature");
  }
  return { viewId, plannerVariant, policySignature };
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

if (command === "adopt") {
  const options = parseArgs(args);
  const recommendationId = args[1];
  const strategyArg = args[2];
  const decision = args[3];
  const rationaleIndex = args.findIndex((arg) => arg === "--rationale");
  const rationale = rationaleIndex >= 0 ? args[rationaleIndex + 1] ?? "" : "";
  const actorIndex = args.findIndex((arg) => arg === "--actor");
  const actor = actorIndex >= 0 ? args[actorIndex + 1] ?? "human" : "human";
  if (!recommendationId || !strategyArg || !decision) {
    throw new Error("Usage: adopt <recommendationId> <strategyKey> <accept|reject|defer> --rationale \"...\" [--actor name]");
  }
  if (!["accept", "reject", "defer"].includes(decision)) {
    throw new Error("Decision must be accept, reject, or defer.");
  }
  const recommendation = await readStoreById(rootDir, "recommendation_reports", recommendationId);
  if (!recommendation) {
    throw new Error("Recommendation not found.");
  }
  const strategyKey = parseStrategyKey(strategyArg);
  const recommended = (recommendation as { recommendedStrategies?: Array<{ strategyKey?: StrategyKey }> })
    .recommendedStrategies ?? [];
  const matchesRecommendation = recommended.some(
    (entry) =>
      entry.strategyKey?.viewId === strategyKey.viewId &&
      entry.strategyKey?.plannerVariant === strategyKey.plannerVariant &&
      entry.strategyKey?.policySignature === strategyKey.policySignature
  );
  if (!matchesRecommendation && decision === "accept") {
    throw new Error("Strategy key not found in recommendation report.");
  }
  const applier = new PolicyApplier(rootDir);
  const adoptionService = new AdoptionService(rootDir);
  if (!rationale.trim()) {
    throw new Error("Rationale is required for adoption.");
  }
  let appliedChanges: Record<string, unknown> = {};
  let beforeStateRefs: Record<string, string> = {};
  let afterStateRefs: Record<string, string> = {};
  if (decision === "accept") {
    const result = await applier.applyViewStrategy({
      adoption: {
        adoptionId: "",
        recommendationId,
        strategyKey,
        scope: "view",
        decision: "accept",
        decidedBy: actor,
        decidedAt: "",
        rationale,
        appliedChanges: {}
      },
      strategyKey
    });
    appliedChanges = result.appliedChanges;
    beforeStateRefs = { viewId: strategyKey.viewId, version: result.previousVersion };
    afterStateRefs = { viewId: strategyKey.viewId, version: result.view.version };
  }
  const adoption = await adoptionService.recordAdoption({
    recommendationId,
    strategyKey,
    scope: "view",
    decision: decision as "accept" | "reject" | "defer",
    decidedBy: actor,
    rationale,
    appliedChanges,
    confirm: options.confirm
  });
  await adoptionService.recordTimeline({
    adoptionId: adoption.adoptionId,
    recommendationId,
    beforeStateRefs,
    afterStateRefs
  });
  console.log("Adoption Summary");
  console.log(`- adoptionId: ${adoption.adoptionId}`);
  console.log(`- decision: ${adoption.decision}`);
  process.exit(0);
}

if (command === "rollback") {
  const adoptionId = args[1];
  const rationaleIndex = args.findIndex((arg) => arg === "--rationale");
  const rationale = rationaleIndex >= 0 ? args[rationaleIndex + 1] ?? "" : "";
  const actorIndex = args.findIndex((arg) => arg === "--actor");
  const actor = actorIndex >= 0 ? args[actorIndex + 1] ?? "human" : "human";
  if (!adoptionId) {
    throw new Error("Usage: rollback <adoptionId> --rationale \"...\" [--actor name]");
  }
  if (!rationale.trim()) {
    throw new Error("Rationale is required for rollback.");
  }
  const rollbackService = new RollbackService(rootDir, new PolicyApplier(rootDir));
  const rollbackAdoption = await rollbackService.rollback({ adoptionId, decidedBy: actor, rationale });
  console.log("Rollback Summary");
  console.log(`- adoptionId: ${rollbackAdoption.adoptionId}`);
  console.log(`- rollbackOf: ${rollbackAdoption.rollbackRef}`);
  process.exit(0);
}

if (command === "governance") {
  const subcommand = args[1];
  const options = parseArgs(args);
  const policyService = new GovernancePolicyService(rootDir);
  if (subcommand === "set") {
    const policy = {
      maxRollbacksPerWindow: Number(args[2] ?? 3),
      minRunsBeforeAdoption: Number(args[3] ?? 3),
      restrictedScopes: ["global"],
      experimentOnlyScopes: ["planner"]
    };
    await policyService.savePolicy(policy);
    console.log("Governance Policy Saved");
    process.exit(0);
  }
  if (subcommand === "report") {
    const analyzer = new GovernanceAnalyzer(rootDir);
    const strategyMetrics = await new OfflineAnalyzer(rootDir).computeStrategyMetrics();
    const report = await analyzer.analyze({ timeWindowDays: 30, strategyMetrics });
    await writeJsonFile(`${rootDir}/data/governance_reports/governance-report.json`, report);
    await appendStore(rootDir, "governance_reports", report);
    console.log("Governance Report Summary");
    console.log(`- total adoptions: ${report.adoptionSummary.totalAdoptions}`);
    console.log(`- rollbacks: ${report.rollbackSummary.totalRollbacks}`);
    process.exit(0);
  }
  throw new Error("Usage: governance <report|set>");
}

if (command === "experiment") {
  const subcommand = args[1];
  const options = parseArgs(args);
  const experimentService = new ExperimentService(rootDir);
  if (subcommand === "create") {
    if (!options.description || !options.views || !options.isolation) {
      throw new Error("Usage: experiment create --description \"...\" --views viewA,viewB --isolation sandbox");
    }
    const experiment = await experimentService.createExperiment({
      description: options.description,
      involvedViews: options.views.split(",").map((view) => view.trim()),
      isolationLevel: options.isolation as "sandbox" | "shadow" | "report-only"
    });
    console.log("Experiment Created");
    console.log(`- id: ${experiment.experimentId}`);
    process.exit(0);
  }
  if (subcommand === "run") {
    const experimentId = args[2];
    if (!experimentId || !options.message) {
      throw new Error("Usage: experiment run <experiment_id> --message \"...\"");
    }
    const experiment = await experimentService.getExperiment(experimentId);
    if (!experiment) {
      throw new Error("Experiment not found.");
    }
    const viewsList = experiment.involvedViews;
    const variants: StrategyVariant[] = viewsList.map((viewId) => ({
      plannerVariantId: "v1",
      viewVariantId: viewId,
      description: `experiment:${experimentId}:${viewId}`
    }));
    const runner = new ExperimentRunner(rootDir, new ContextPlanner());
    const { report, comparison } = await runner.run({
      experiment,
      message: options.message,
      variants
    });
    await experimentService.recordReport(report);
    await writeJsonFile(
      `${rootDir}/data/experiment_reports/experiment-${experimentId}-comparison.json`,
      comparison
    );
    console.log("Experiment Run Summary");
    console.log(`- comparisons: ${report.summary.comparisons}`);
    process.exit(0);
  }
  if (subcommand === "report") {
    const experimentId = args[2];
    if (!experimentId) {
      throw new Error("Usage: experiment report <experiment_id>");
    }
    const report = await readStoreById(rootDir, "experiment_reports", experimentId);
    if (!report) {
      throw new Error("Experiment report not found.");
    }
    console.log("Experiment Report Summary");
    const summary = report as { summary?: { comparisons?: number } };
    console.log(`- comparisons: ${summary.summary?.comparisons ?? 0}`);
    process.exit(0);
  }
  throw new Error("Usage: experiment <create|run|report>");
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
