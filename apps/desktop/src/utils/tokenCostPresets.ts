import bundled from "../data/tokenCostPresets.json";
import {
  isTokenCostPresetDocument, type TokenCostPreset, type TokenCostPresetDocument,
} from "../../../../shared/token-cost-presets";

export const DEFAULT_REFERENCE_MODEL = bundled.defaultReferenceModel;
export const TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY = "codex-switch:token-cost-reference-model";
export const TOKEN_COST_REFERENCE_MODEL_EVENT = "codex-switch:token-cost-reference-model-changed";
export const TOKEN_COST_CATALOG_STORAGE_KEY = "codex-switch:token-cost-preset-catalog";
export let TOKEN_COST_PRESETS: TokenCostPreset[] = bundled.models;
export let UNPRICED_PRESET_MODELS = bundled.unpricedModels;
export let TOKEN_COST_PRESETS_VERIFIED_AT = bundled.verifiedAt;
export let TOKEN_COST_PRESETS_SOURCE_URL = bundled.sourceUrl;

function mergeDocument(document: TokenCostPresetDocument) {
  const models = new Map<string, TokenCostPreset>(bundled.models.map((preset) => [preset.model, preset]));
  document.models.forEach((preset) => models.set(preset.model, preset));
  const merged = { ...document, models: [...models.values()] };
  // Check aliases against bundled models too, so remote additions cannot shadow another model.
  if (!isTokenCostPresetDocument(merged)) return false;
  TOKEN_COST_PRESETS = merged.models;
  UNPRICED_PRESET_MODELS = bundled.unpricedModels.filter((model) => !models.has(model));
  TOKEN_COST_PRESETS_VERIFIED_AT = merged.verifiedAt;
  TOKEN_COST_PRESETS_SOURCE_URL = merged.sourceUrl;
  return true;
}

export function reloadCachedTokenCostPresets() {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(TOKEN_COST_CATALOG_STORAGE_KEY) ?? "null");
    if (isTokenCostPresetDocument(value)) mergeDocument(value);
  } catch { /* Unavailable or damaged storage leaves bundled/current prices in use. */ }
}

export function applyTokenCostPresets(value: unknown): boolean {
  if (!isTokenCostPresetDocument(value) || !mergeDocument(value)) return false;
  try { window.localStorage.setItem(TOKEN_COST_CATALOG_STORAGE_KEY, JSON.stringify(value)); }
  catch { /* The fetched prices still apply for this session when storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(TOKEN_COST_REFERENCE_MODEL_EVENT));
  return true;
}

export function currentTokenCostCatalog() {
  return { ...bundled, models: TOKEN_COST_PRESETS, unpricedModels: UNPRICED_PRESET_MODELS,
    verifiedAt: TOKEN_COST_PRESETS_VERIFIED_AT, sourceUrl: TOKEN_COST_PRESETS_SOURCE_URL };
}

reloadCachedTokenCostPresets();

export function findTokenCostPreset(model: string) {
  const normalized = model.trim().toLowerCase();
  if (UNPRICED_PRESET_MODELS.some((unpriced) => normalized === unpriced
    || normalized.startsWith(`${unpriced}-`))) return undefined;
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
  } catch { return DEFAULT_REFERENCE_MODEL; }
}

export function saveTokenCostReferenceModel(model: string) {
  if (!TOKEN_COST_PRESETS.some((preset) => preset.model === model)) return;
  window.localStorage.setItem(TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY, model);
  window.dispatchEvent(new CustomEvent(TOKEN_COST_REFERENCE_MODEL_EVENT));
}

export function referenceTokenCostPreset() {
  // The bundled default always survives merging, even if the administrator omits it.
  return findTokenCostPreset(loadTokenCostReferenceModel()) ?? TOKEN_COST_PRESETS.find(
    (preset) => preset.model === DEFAULT_REFERENCE_MODEL,
  )!;
}