import { readStore } from "../../../../data-layer/src/jsonStore.js";
import type { Anchor, ContextItem } from "../../../../packages/shared-types/src/types.js";
import { estimateTokens } from "../../../../packages/utils/src/token.js";

export class AnchorsService {
  constructor(private readonly rootDir: string) {}

  async listAnchors(): Promise<ContextItem[]> {
    const anchors = (await readStore(this.rootDir, "anchors")) as Anchor[];
    return anchors.map((anchor) => ({
      id: anchor.id,
      type: "anchor",
      content: `${anchor.label}: ${anchor.content}`,
      source: anchor.scope,
      tokens: estimateTokens(anchor.content)
    }));
  }
}
