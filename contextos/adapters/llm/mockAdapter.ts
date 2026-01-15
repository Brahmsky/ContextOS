import type { ILLMAdapter } from "../../packages/shared-types/src/contracts.js";
import type { ModelCallPlan } from "../../packages/shared-types/src/types.js";

export class MockLLMAdapter implements ILLMAdapter {
  // Mock adapter to keep end-to-end flow running without external dependencies.
  async execute(plan: ModelCallPlan): Promise<{ text: string }> {
    const lastUser = plan.messages.filter((msg) => msg.role === "user").pop();
    return {
      text: `MockLLM (${plan.modelId}): received '${lastUser?.content ?? ""}'`
    };
  }
}
