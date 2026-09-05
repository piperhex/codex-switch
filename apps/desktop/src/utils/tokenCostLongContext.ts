import catalog from "../data/tokenCostPresets.json";
import { findTokenCostPreset, referenceTokenCostPreset } from "./tokenCostPresets";

export interface LongContextCostSettings {
  enabled: boolean;
  thresholdTokens: number;
  inputMultiplier: number;
  cachedInputMultiplier: number;
  outputMultiplier: number;
}

export const DEFAULT_LONG_CONTEXT_COST_SETTINGS: Readonly<LongContextCostSettings> = Object.freeze(
  { ...catalog.defaultLongContextCostSettings },
);
export const MAX_LONG_CONTEXT_THRESHOLD_TOKENS = catalog.maxLongContextThresholdTokens;
export const MAX_LONG_CONTEXT_COST_MULTIPLIER = catalog.maxLongContextCostMultiplier;
export const LONG_CONTEXT_COST_STORAGE_KEY = "codex-switch:long-context-cost-settings";
export const LONG_CONTEXT_COST_EVENT = "codex-switch:long-context-cost-settings-changed";

export function isValidLongContextCostSettings(value: unknown): value is LongContextCostSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Partial<LongContextCostSettings>;
  return typeof settings.enabled === "boolean"
    && typeof settings.thresholdTokens === "number" && Number.isSafeInteger(settings.thresholdTokens)
    && settings.thresholdTokens > 0 && settings.thresholdTokens <= MAX_LONG_CONTEXT_THRESHOLD_TOKENS
    && [settings.inputMultiplier, settings.cachedInputMultiplier, settings.outputMultiplier].every(
      (multiplier) => typeof multiplier === "number" && Number.isFinite(multiplier)
        && multiplier > 0 && multiplier <= MAX_LONG_CONTEXT_COST_MULTIPLIER,
    );
}

export function loadLongContextCostSettings(): LongContextCostSettings {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LONG_CONTEXT_COST_STORAGE_KEY) ?? "null");
    return isValidLongContextCostSettings(value) ? value : { ...DEFAULT_LONG_CONTEXT_COST_SETTINGS };
  } catch {
    return { ...DEFAULT_LONG_CONTEXT_COST_SETTINGS };
  }
}

export function saveLongContextCostSettings(settings: LongContextCostSettings) {
  if (!isValidLongContextCostSettings(settings)) return;
  window.localStorage.setItem(LONG_CONTEXT_COST_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(LONG_CONTEXT_COST_EVENT));
}

export function longContextMultipliersForEntry(model: string, inputTokens: number) {
  const settings = loadLongContextCostSettings();
  const preset = findTokenCostPreset(model) ?? referenceTokenCostPreset();
  // The threshold includes cached input and applies to the full request, not only the excess tokens.
  const longContext = settings.enabled && preset.longContextPricing
    && Number.isFinite(inputTokens) && inputTokens > settings.thresholdTokens;
  return {
    input: longContext ? settings.inputMultiplier : 1,
    cachedInput: longContext ? settings.cachedInputMultiplier : 1,
    output: longContext ? settings.outputMultiplier : 1,
  };
}
