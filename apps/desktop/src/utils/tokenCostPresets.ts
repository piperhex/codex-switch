import catalog from "../data/tokenCostPresets.json";

export const TOKEN_COST_PRESETS = catalog.models;
export const UNPRICED_PRESET_MODELS = catalog.unpricedModels;
export const DEFAULT_REFERENCE_MODEL = catalog.defaultReferenceModel;
export const TOKEN_COST_PRESETS_VERIFIED_AT = catalog.verifiedAt;
export const TOKEN_COST_PRESETS_SOURCE_URL = catalog.sourceUrl;
export const TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY = "codex-switch:token-cost-reference-model";
export const TOKEN_COST_REFERENCE_MODEL_EVENT = "codex-switch:token-cost-reference-model-changed";

export function findTokenCostPreset(model: string) {
  const normalized = model.trim().toLowerCase();
  return TOKEN_COST_PRESETS
    .filter((preset) => normalized === preset.model || preset.aliases?.includes(normalized)
      || normalized.startsWith(`${preset.model}-`))
    .sort((left, right) => right.model.length - left.model.length)[0];
}

export function loadTokenCostReferenceModel(): string {
  try {
    const saved = window.localStorage.getItem(TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY);
    return saved !== null && TOKEN_COST_PRESETS.some((preset) => preset.model === saved)
      ? saved : DEFAULT_REFERENCE_MODEL;
  } catch {
    return DEFAULT_REFERENCE_MODEL;
  }
}

export function saveTokenCostReferenceModel(model: string) {
  if (!TOKEN_COST_PRESETS.some((preset) => preset.model === model)) return;
  window.localStorage.setItem(TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY, model);
  window.dispatchEvent(new CustomEvent(TOKEN_COST_REFERENCE_MODEL_EVENT));
}

export function referenceTokenCostPreset() {
  // Both choices come from the bundled catalog; its default is checked in the catalog tests.
  return findTokenCostPreset(loadTokenCostReferenceModel()) ?? TOKEN_COST_PRESETS.find(
    (preset) => preset.model === DEFAULT_REFERENCE_MODEL,
  )!;
}
