import type { ContextItem } from "../../../packages/shared-types/src/types.js";

export class MemoryService {
  async read(): Promise<ContextItem[]> {
    return [];
  }
}
