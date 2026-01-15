import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Orchestrator } from "../../../services/orchestrator/src/orchestrator.js";
import { loadViews } from "../../../services/orchestrator/src/viewLoader.js";
import { IntentEstimator } from "../../../services/logic-engine/src/estimator/intentEstimator.js";
import { ContextPlanner } from "../../../services/logic-engine/src/planner/contextPlanner.js";
import { WritebackController } from "../../../services/logic-engine/src/writeback/writebackController.js";
import { MockLLMAdapter } from "../../../adapters/llm/mockAdapter.js";
import { DeepSeekAdapter } from "../../../adapters/llm/deepseekAdapter.js";
import { ContextPlansService } from "../../../services/domain-services/src/contextPlans/service.js";
import { RecipesService } from "../../../services/domain-services/src/recipes/service.js";
import { diffRecipes } from "../../../packages/shared-types/src/diff.js";
import { writeJsonFile } from "../../../packages/utils/src/files.js";
import { appendStore } from "../../../data-layer/src/jsonStore.js";
import { detectDrift } from "../../../services/logic-engine/drift/driftDetector.js";
import { readStoreById } from "../../../data-layer/src/jsonStore.js";
import { runRegression } from "../../../services/logic-engine/regression/regressionRunner.js";
import { hashJson, hashPlan } from "../../../packages/utils/src/hash.js";
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
import { loadEnvConfig } from "../../../packages/utils/src/env.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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
    provider?: string;
    mode?: string;
    maxRollbacks?: number;
    restrictedScopes?: string;
    experimentOnlyScopes?: string;
    mode?: string;
    planner?: string;
    includeIslandsSpec?: string;
    excludeIslandsSpec?: string;
    includeAnchorsSpec?: string;
    excludeAnchorsSpec?: string;
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
    if (arg === "--provider") {
      options.provider = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--mode") {
      options.mode = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--mode") {
      options.mode = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--planner") {
      options.planner = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--include-islands") {
      options.includeIslandsSpec = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--exclude-islands") {
      options.excludeIslandsSpec = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--include-anchors") {
      options.includeAnchorsSpec = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--exclude-anchors") {
      options.excludeAnchorsSpec = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--max-rollbacks") {
      const parsed = Number(input[i + 1]);
      if (!Number.isNaN(parsed)) {
        options.maxRollbacks = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === "--restricted-scopes") {
      options.restrictedScopes = input[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--experiment-only-scopes") {
      options.experimentOnlyScopes = input[i + 1];
      i += 1;
      continue;
    }
  }
  return options;
};

const globalOptions = parseArgs(args);
let orchestratorInstance: Orchestrator | undefined;
const getOrchestrator = async (): Promise<Orchestrator> => {
  if (orchestratorInstance) {
    return orchestratorInstance;
  }
  const providerOverride =
    globalOptions.provider === "mock" || globalOptions.provider === "deepseek"
      ? globalOptions.provider
      : undefined;
  const modeOverride =
    globalOptions.mode === "experiment" || globalOptions.mode === "main"
      ? globalOptions.mode
      : undefined;
  const envConfig = await loadEnvConfig({
    rootDir,
    overrides: {
      provider: providerOverride,
      mode: modeOverride
    }
  });
  const adapter =
    envConfig.provider === "deepseek"
      ? new DeepSeekAdapter(envConfig, rootDir)
      : new MockLLMAdapter();
  orchestratorInstance = new Orchestrator(
    rootDir,
    new IntentEstimator(),
    new ContextPlanner(),
    adapter,
    new WritebackController(rootDir)
  );
  return orchestratorInstance;
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
  const orchestrator = await getOrchestrator();
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
  const orchestrator = await getOrchestrator();
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
    baselinePlanHash: hashPlan(baselinePlan),
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
  if (subcommand === "report") {
    const analyzer = new GovernanceAnalyzer(rootDir);
    const report = await analyzer.analyze();
    await writeJsonFile(`${rootDir}/data/governance_report.json`, report);
    console.log("Governance Report Summary");
    console.log(`- total adoptions: ${report.totalAdoptions}`);
    console.log(`- rollbacks: ${Math.round(report.rollbackRate * report.totalAdoptions)}`);
    process.exit(0);
  }
  if (subcommand === "policy") {
    const action = args[2];
    if (action === "set") {
      const policy = {
        maxRollbacksPerWindow: options.maxRollbacks ?? 3,
        restrictedScopes: (options.restrictedScopes ?? "global").split(",").map((scope) => scope.trim()),
        experimentOnlyScopes: (options.experimentOnlyScopes ?? "planner").split(",").map((scope) => scope.trim())
      };
      await policyService.savePolicy(policy);
      console.log("Governance Policy Saved");
      process.exit(0);
    }
    if (action === "show") {
      const policy = await policyService.loadPolicy();
      console.log(JSON.stringify(policy, null, 2));
      process.exit(0);
    }
    throw new Error("Usage: governance policy <set|show> [--max-rollbacks N] [--restricted-scopes a,b] [--experiment-only-scopes a,b]");
  }
  throw new Error("Usage: governance <report|policy>");
}

if (command === "experiment") {
  const subcommand = args[1];
  const options = parseArgs(args);
  const experimentService = new ExperimentService(rootDir);
  const experimentRunner = new ExperimentRunner(rootDir, experimentService);
  if (subcommand === "spec") {
    const action = args[2];
    if (action === "create") {
      if (!options.message || !options.mode || !options.views || !options.planner) {
        throw new Error(
          "Usage: experiment spec create --message \"...\" --mode multi_view --views debug@v1,plan@v1 --planner a,b"
        );
      }
      const snapshot = await experimentRunner.createCandidatePoolSnapshot();
      const views = options.views.split(",").map((entry) => {
        const [viewId, version] = entry.trim().split("@");
        if (!viewId || !version) {
          throw new Error("Views must be formatted as viewId@version.");
        }
        return { viewId, version };
      });
      const spec = await experimentService.createSpec({
        message: options.message,
        candidatePoolSnapshotRef: snapshot.snapshotId,
        compositionMode: options.mode as "multi_view" | "view_blend" | "context_paint",
        views,
        plannerVariants: options.planner.split(",").map((entry) => entry.trim()),
        contextOverrides: {
          includeIslands: options.includeIslandsSpec?.split(",").map((entry) => entry.trim()),
          excludeIslands: options.excludeIslandsSpec?.split(",").map((entry) => entry.trim()),
          includeAnchors: options.includeAnchorsSpec?.split(",").map((entry) => entry.trim()),
          excludeAnchors: options.excludeAnchorsSpec?.split(",").map((entry) => entry.trim())
        },
        isolationLevel: "sandbox",
        forbidWriteback: true
      });
      await writeJsonFile(`${rootDir}/data/experiments/spec-${spec.specId}.json`, spec);
      console.log("Experiment Spec Created");
      console.log(`- specId: ${spec.specId}`);
      console.log(`- candidatePool: ${snapshot.snapshotId}`);
      process.exit(0);
    }
    throw new Error("Usage: experiment spec create --message \"...\" --mode multi_view --views view@v1 --planner a,b");
  }
  if (subcommand === "run") {
    const specIndex = args.findIndex((arg) => arg === "--spec");
    const specId = specIndex >= 0 ? args[specIndex + 1] : args[2];
    if (!specId) {
      throw new Error("Usage: experiment run --spec <spec_id>");
    }
    const spec = await experimentService.getSpec(specId);
    if (!spec) {
      throw new Error("Experiment spec not found.");
    }
    const result = await experimentRunner.run(spec);
    console.log("Experiment Run Summary");
    console.log(`- experimentId: ${result.experimentId}`);
    console.log(`- runs: ${result.runs.length}`);
    process.exit(0);
  }
  if (subcommand === "export") {
    const idIndex = args.findIndex((arg) => arg === "--id");
    const experimentId = idIndex >= 0 ? args[idIndex + 1] : args[2];
    const formatIndex = args.findIndex((arg) => arg === "--format");
    const format = formatIndex >= 0 ? args[formatIndex + 1] : "canvas";
    if (!experimentId) {
      throw new Error("Usage: experiment export --id <experiment_id> --format canvas");
    }
    if (format !== "canvas") {
      throw new Error("Only canvas export is supported.");
    }
    const bundle = await experimentService.getCanvasBundle(experimentId);
    if (!bundle) {
      throw new Error("Canvas bundle not found.");
    }
    const outputPath = `${rootDir}/data/experiments/canvas-export-${experimentId}.json`;
    await writeJsonFile(outputPath, bundle);
    console.log("Experiment Exported");
    console.log(`- path: ${outputPath}`);
    process.exit(0);
  }
  if (subcommand === "show") {
    const idIndex = args.findIndex((arg) => arg === "--id");
    const experimentId = idIndex >= 0 ? args[idIndex + 1] : args[2];
    if (!experimentId) {
      throw new Error("Usage: experiment show --id <experiment_id>");
    }
    const bundle = await experimentService.getCanvasBundle(experimentId);
    const runs = await experimentService.listCompositionRuns(experimentId);
    console.log(
      JSON.stringify(
        {
          experimentId,
          runs: runs.map((run) => ({
            runId: run.runId,
            variantId: run.variantId,
            planRef: run.planRef,
            diffRef: run.diffRef,
            driftRef: run.driftRef
          })),
          bundleRef: bundle ? `canvas:${bundle.bundleId}` : null
        },
        null,
        2
      )
    );
    process.exit(0);
  }
  throw new Error("Usage: experiment <spec|run|export|show>");
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
const orchestrator = await getOrchestrator();

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
