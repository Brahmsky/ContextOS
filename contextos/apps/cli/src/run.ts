import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Orchestrator } from "../../../services/orchestrator/src/orchestrator.js";
import { IntentEstimator } from "../../../services/logic-engine/src/estimator/intentEstimator.js";
import { ContextPlanner } from "../../../services/logic-engine/src/planner/contextPlanner.js";
import { WritebackController } from "../../../services/logic-engine/src/writeback/writebackController.js";
import { MockLLMAdapter } from "../../../adapters/llm/mockAdapter.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const orchestrator = new Orchestrator(
  rootDir,
  new IntentEstimator(),
  new ContextPlanner(),
  new MockLLMAdapter(),
  new WritebackController(rootDir)
);

const message = process.argv.slice(2).join(" ") || "Hello ContextOS";

const response = await orchestrator.handleTurn({
  userId: "local",
  threadId: "demo",
  message
});

console.log("Assistant:", response.assistantMessage);
