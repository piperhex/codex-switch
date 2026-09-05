import catalog from "../data/tokenCostPresets.json";

export const DEFAULT_FAST_MODE_COST_MULTIPLIER = catalog.defaultFastModeCostMultiplier;
export const MAX_FAST_MODE_COST_MULTIPLIER = catalog.maxFastModeCostMultiplier;
export const FAST_MODE_COST_MULTIPLIER_STORAGE_KEY = "codex-switch:fast-mode-cost-multiplier";
export const FAST_MODE_COST_MULTIPLIER_EVENT = "codex-switch:fast-mode-cost-multiplier-changed";

export function isValidFastModeCostMultiplier(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value > 0 && value <= MAX_FAST_MODE_COST_MULTIPLIER;
}

export function loadFastModeCostMultiplier(): number {
  try {
    const stored = window.localStorage.getItem(FAST_MODE_COST_MULTIPLIER_STORAGE_KEY);
    const value: unknown = JSON.parse(stored ?? "null");
    return isValidFastModeCostMultiplier(value) ? value : DEFAULT_FAST_MODE_COST_MULTIPLIER;
  } catch {
    return DEFAULT_FAST_MODE_COST_MULTIPLIER;
  }
}

export function saveFastModeCostMultiplier(value: number) {
  if (!isValidFastModeCostMultiplier(value)) return;
  window.localStorage.setItem(FAST_MODE_COST_MULTIPLIER_STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(FAST_MODE_COST_MULTIPLIER_EVENT));
}

export function costMultiplierForServiceTier(serviceTier: string | null | undefined): number {
  // Missing tiers belong to old records whose request mode cannot be reconstructed safely.
  return serviceTier === "priority" || serviceTier === "fast" ? loadFastModeCostMultiplier() : 1;
}
