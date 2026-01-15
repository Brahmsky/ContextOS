import { randomUUID } from "node:crypto";
import type { ILLMAdapter } from "../../packages/shared-types/src/contracts.js";
import type { ModelCallPlan } from "../../packages/shared-types/src/types.js";
import type { EnvConfig } from "../../packages/utils/src/env.js";
import type { ModelCallAttempt, ModelCallRecord } from "../../packages/shared-types/src/llm.js";
import { appendStore } from "../../data-layer/src/jsonStore.js";
import { hashJson } from "../../packages/utils/src/hash.js";

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const baseUrlHost = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

export class DeepSeekAdapter implements ILLMAdapter {
  constructor(private readonly config: EnvConfig, private readonly rootDir: string) {}

  async execute(plan: ModelCallPlan): Promise<{ text: string }> {
    const startedAt = new Date();
    const promptHash = hashJson({ messages: plan.messages, tools: plan.tools });
    const planHash = hashJson(plan);
    const temperature = plan.temperature ?? this.config.defaults.temperature;
    const topP = this.config.defaults.topP;
    const maxTokens = this.config.defaults.maxTokens;
    const stop = undefined;
    const attempts: ModelCallAttempt[] = [];
    const requestBody = {
      model: this.config.deepseek.model,
      messages: plan.messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens
    };

    const retryStatus = (status: number) => status === 429 || status >= 500;
    let responseText = "";
    let httpStatus = 0;
    let errorSummary: string | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const attemptStarted = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.defaults.requestTimeoutMs);
      try {
        const response = await fetch(`${this.config.deepseek.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.deepseek.apiKey ?? ""}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        httpStatus = response.status;
        const durationMs = Date.now() - attemptStarted;
        if (!response.ok) {
          const text = await response.text();
          const error = `HTTP ${response.status}: ${text.slice(0, 200)}`;
          attempts.push({ attempt, startedAt: new Date(attemptStarted).toISOString(), durationMs, httpStatus, error });
          if (response.status === 401 || response.status === 403) {
            errorSummary = "Authentication failed. Check DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL.";
            break;
          }
          if (response.status === 402) {
            errorSummary = "Billing issue (HTTP 402). Check account credits.";
            break;
          }
          if (attempt < 3 && retryStatus(response.status)) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
            continue;
          }
          errorSummary = error;
          break;
        }

        const json = (await response.json()) as DeepSeekResponse;
        responseText = json.choices?.[0]?.message?.content ?? "";
        attempts.push({
          attempt,
          startedAt: new Date(attemptStarted).toISOString(),
          durationMs,
          httpStatus
        });

        const durationMs = Date.now() - startedAt.getTime();
        const record: ModelCallRecord = {
          id: randomUUID(),
          provider: "deepseek",
          mode: this.config.mode,
          baseUrl: baseUrlHost(this.config.deepseek.baseUrl),
          model: this.config.deepseek.model,
          temperature,
          topP,
          maxTokens,
          stop,
          promptHash,
          planHash,
          startedAt: startedAt.toISOString(),
          durationMs,
          httpStatus,
          usage: {
            inputTokens: json.usage?.prompt_tokens,
            outputTokens: json.usage?.completion_tokens,
            totalTokens: json.usage?.total_tokens
          },
          responseHash: hashJson(responseText),
          status: "success",
          attempts
        };
        await this.writeRecord(record);
        if (this.config.logging.logRequest) {
          console.log("[LLM] request", { provider: record.provider, model: record.model, promptHash, planHash });
        }
        if (this.config.logging.logResponse) {
          console.log("[LLM] response", { responseHash: record.responseHash, httpStatus });
        }
        return { text: responseText };
      } catch (error) {
        const durationMs = Date.now() - attemptStarted;
        const message = error instanceof Error ? error.message : "Unknown error";
        attempts.push({
          attempt,
          startedAt: new Date(attemptStarted).toISOString(),
          durationMs,
          error: message
        });
        errorSummary = message;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    const record: ModelCallRecord = {
      id: randomUUID(),
      provider: "deepseek",
      mode: this.config.mode,
      baseUrl: baseUrlHost(this.config.deepseek.baseUrl),
      model: this.config.deepseek.model,
      temperature,
      topP,
      maxTokens,
      stop,
      promptHash,
      planHash,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      httpStatus,
      responseHash: responseText ? hashJson(responseText) : undefined,
      status: "error",
      errorSummary,
      attempts
    };
    await this.writeRecord(record);
    throw new Error(errorSummary ?? "DeepSeek request failed.");
  }

  private async writeRecord(record: ModelCallRecord): Promise<void> {
    if (this.config.mode !== "experiment") {
      return;
    }
    await appendStore(this.rootDir, "experiment_model_calls", record);
  }
}
