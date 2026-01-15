// Rough token estimator to keep planner budgeting simple in V1.
export function estimateTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }
  return Math.ceil(normalized.length / 4);
}
