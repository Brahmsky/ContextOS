import { readStore } from "../../../../data-layer/src/jsonStore.js";
import type { ContextItem, Island } from "../../../../packages/shared-types/src/types.js";
import { estimateTokens } from "../../../../packages/utils/src/token.js";

export class IslandsService {
  constructor(private readonly rootDir: string) {}

  async selectCandidates(maxItems: number): Promise<ContextItem[]> {
    const islands = (await readStore(this.rootDir, "islands")) as Island[];
    return islands.slice(0, maxItems).map((island) => ({
      id: island.id,
      type: "island",
      content: `${island.title}: ${island.summary}`,
      source: "islands",
      score: 1 - island.driftScore,
      tokens: estimateTokens(island.summary)
    }));
  }
}
