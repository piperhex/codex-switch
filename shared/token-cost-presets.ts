export interface TokenCostPreset {
  model: string;
  aliases?: string[];
  input: number;
  cachedInput: number;
  output: number;
  longContextPricing: boolean;
  fastModeMultiplier: number | null;
  sourceUrl: string;
}

export interface TokenCostPresetDocument {
  models: TokenCostPreset[];
  verifiedAt: string;
  sourceUrl: string;
}

export const MAX_TOKEN_COST_PRESETS = 1000;
export const MAX_TOKEN_PRICE = 1_000_000_000;
export const MAX_PRESET_MULTIPLIER = 100;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_ALIASES = 20;
const MAX_SOURCE_URL_LENGTH = 2048;
const MODEL_NAME = /^[a-z0-9][a-z0-9._:/-]*$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_IDENTIFIER_LENGTH && MODEL_NAME.test(value);
}

function validSource(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_SOURCE_URL_LENGTH) return false;
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function validPreset(value: unknown): value is TokenCostPreset {
  if (!record(value) || !validName(value.model) || !validSource(value.sourceUrl)) return false;
  const rates = [value.input, value.cachedInput, value.output];
  return rates.every((rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= MAX_TOKEN_PRICE)
    && typeof value.longContextPricing === "boolean"
    && (value.fastModeMultiplier === null || (typeof value.fastModeMultiplier === "number"
      && Number.isFinite(value.fastModeMultiplier)
      && value.fastModeMultiplier > 0 && value.fastModeMultiplier <= MAX_PRESET_MULTIPLIER))
    && (value.aliases === undefined || (Array.isArray(value.aliases)
      && value.aliases.length <= MAX_ALIASES && value.aliases.every(validName)));
}

export function isTokenCostPresetDocument(value: unknown): value is TokenCostPresetDocument {
  if (!record(value) || !Array.isArray(value.models) || !value.models.length
    || value.models.length > MAX_TOKEN_COST_PRESETS || !value.models.every(validPreset)
    || typeof value.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt)
    || !validSource(value.sourceUrl)) return false;
  const names = value.models.flatMap((preset) => [preset.model, ...(preset.aliases ?? [])]);
  return new Set(names).size === names.length;
}