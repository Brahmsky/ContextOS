import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type LlmProvider = "mock" | "deepseek";
export type LlmMode = "experiment" | "main";

export type EnvConfig = {
  provider: LlmProvider;
  mode: LlmMode;
  deepseek: {
    apiKey?: string;
    baseUrl: string;
    model: string;
  };
  defaults: {
    temperature: number;
    topP: number;
    maxTokens: number;
    requestTimeoutMs: number;
  };
  logging: {
    logRequest: boolean;
    logResponse: boolean;
  };
};

type LoadEnvParams = {
  rootDir: string;
  overrides?: Partial<Pick<EnvConfig, "provider" | "mode">>;
  requireKey?: boolean;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const loadDotEnv = async (rootDir: string): Promise<Record<string, string>> => {
  const envPath = resolve(rootDir, ".env");
  try {
    const raw = await readFile(envPath, "utf-8");
    return raw.split("\n").reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return acc;
      }
      const [key, ...rest] = trimmed.split("=");
      if (!key) {
        return acc;
      }
      acc[key.trim()] = rest.join("=").trim();
      return acc;
    }, {});
  } catch {
    return {};
  }
};

export async function loadEnvConfig(params: LoadEnvParams): Promise<EnvConfig> {
  const dotEnv = await loadDotEnv(params.rootDir);
  const lookup = (key: string) => process.env[key] ?? dotEnv[key];

  const provider = (params.overrides?.provider ?? lookup("LLM_PROVIDER") ?? "mock") as LlmProvider;
  const mode = (params.overrides?.mode ?? lookup("LLM_MODE") ?? "experiment") as LlmMode;

  const config: EnvConfig = {
    provider,
    mode,
    deepseek: {
      apiKey: lookup("DEEPSEEK_API_KEY"),
      baseUrl: lookup("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
      model: lookup("DEEPSEEK_MODEL") ?? "deepseek-chat"
    },
    defaults: {
      temperature: parseNumber(lookup("LLM_TEMPERATURE"), 0),
      topP: parseNumber(lookup("LLM_TOP_P"), 1),
      maxTokens: parseNumber(lookup("LLM_MAX_TOKENS"), 2048),
      requestTimeoutMs: parseNumber(lookup("LLM_REQUEST_TIMEOUT_MS"), 60000)
    },
    logging: {
      logRequest: parseBoolean(lookup("LLM_LOG_REQUEST"), true),
      logResponse: parseBoolean(lookup("LLM_LOG_RESPONSE"), false)
    }
  };

  if (params.requireKey !== false && config.provider === "deepseek" && !config.deepseek.apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek.");
  }

  return config;
}
