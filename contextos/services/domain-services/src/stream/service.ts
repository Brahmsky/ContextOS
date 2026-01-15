import { appendStore, readStore } from "../../../../data-layer/src/jsonStore.js";
import type { ContextItem } from "../../../../packages/shared-types/src/types.js";
import { estimateTokens } from "../../../../packages/utils/src/token.js";

export type StreamRecord = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export class StreamService {
  constructor(private readonly rootDir: string) {}

  async append(record: StreamRecord): Promise<StreamRecord> {
    return (await appendStore(this.rootDir, "stream", record)) as StreamRecord;
  }

  async recent(limit: number): Promise<ContextItem[]> {
    const records = (await readStore(this.rootDir, "stream")) as StreamRecord[];
    const selected = records.slice(-limit);
    return selected.map((record) => ({
      id: record.id ?? "",
      type: "stream",
      content: record.content,
      source: record.role,
      tokens: estimateTokens(record.content)
    }));
  }

  async window(middleTurns: number): Promise<ContextItem[]> {
    const records = (await readStore(this.rootDir, "stream")) as StreamRecord[];
    const start = Math.max(0, records.length - middleTurns * 2);
    const selected = records.slice(start, records.length - middleTurns);
    return selected.map((record) => ({
      id: record.id ?? "",
      type: "stream",
      content: record.content,
      source: record.role,
      tokens: estimateTokens(record.content)
    }));
  }
}
