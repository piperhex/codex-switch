import type { ThreadTokenUsage } from "./types";

export const FULL_PERCENT = 100;

export function contextUsage(usage?: ThreadTokenUsage) {
  const used = usage?.last.totalTokens;
  const total = usage?.modelContextWindow;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  const capacity = typeof total === "number" && Number.isFinite(total) && total > 0 ? total : null;
  const percent = capacity === null ? null : Math.min(FULL_PERCENT, Math.round(used / capacity * FULL_PERCENT));
  return { used, capacity, percent };
}
