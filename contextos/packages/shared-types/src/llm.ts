export interface ModelCallAttempt {
  attemptIndex: number;
  startedAt: string;
  durationMs: number;
  httpStatus?: number;
  retryable: boolean;
  backoffMs?: number;
  errorSummary?: string;
}

export interface ModelCallRecord {
  id: string;
  provider: "deepseek";
  mode: "experiment" | "main";
  baseUrl: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  stop?: string[];
  promptHash: string;
  planHash: string;
  startedAt: string;
  durationMs: number;
  httpStatus: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  responseHash?: string;
  status: "success" | "error";
  fatalReason?: "auth" | "billing";
  errorSummary?: string;
  attempts: ModelCallAttempt[];
}
