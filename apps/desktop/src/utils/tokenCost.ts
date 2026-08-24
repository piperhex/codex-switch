import type { Provider, TokenUsageEntry } from "../types";

const TOKENS_PER_MILLION = 1_000_000;
const TOKEN_COST_DISPLAY_STORAGE_KEY = "codex-switch:token-cost-display";
export const TOKEN_COST_DISPLAY_EVENT = "codex-switch:token-cost-display-changed";

export interface TokenCostDisplaySettings {
  unit: string;
  usdMultiplier: number;
}

export const DEFAULT_TOKEN_COST_DISPLAY_SETTINGS: TokenCostDisplaySettings = {
  unit: "USD",
  usdMultiplier: 1,
};

interface TokenCostRate {
  input: number;
  cachedInput: number;
  output: number;
}

// OpenAI API prices are USD per one million tokens. Unknown models intentionally
// use the Sol fallback so estimates remain useful for private and relay models.
const SOL_FALLBACK_RATE: TokenCostRate = { input: 1.25, cachedInput: 0.125, output: 10 };
const OPENAI_API_RATES: Record<string, TokenCostRate> = {
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  o3: { input: 2, cachedInput: 0.5, output: 8 },
  "o4-mini": { input: 1.1, cachedInput: 0.275, output: 4.4 },
};

function findOpenAiRate(model: string): TokenCostRate {
  const normalized = model.trim().toLowerCase();
  const key = Object.keys(OPENAI_API_RATES)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`));
  return key ? OPENAI_API_RATES[key] : SOL_FALLBACK_RATE;
}

function providerForEntry(entry: TokenUsageEntry, providers: Provider[]) {
  if (entry.providerId) {
    const byId = providers.find((provider) => provider.id === entry.providerId);
    if (byId) return byId;
  }
  return providers.find((provider) => provider.name === entry.provider.trim());
}

function rateForEntry(entry: TokenUsageEntry, providers: Provider[]): TokenCostRate {
  const provider = providerForEntry(entry, providers);
  const configured = provider?.modelTokenCosts?.[entry.model];
  if (provider?.kind === "custom") {
    if (typeof configured === "number" && configured >= 0) {
      return { input: configured, cachedInput: configured, output: configured };
    }
    return SOL_FALLBACK_RATE;
  }
  return findOpenAiRate(entry.model);
}

export function estimateTokenCost(entry: TokenUsageEntry, providers: Provider[]): number {
  const inputTokens = Math.max(0, entry.inputTokens ?? 0);
  const cachedTokens = Math.min(inputTokens, Math.max(0, entry.cachedTokens ?? 0));
  const outputTokens = Math.max(0, entry.outputTokens ?? 0);
  const rate = rateForEntry(entry, providers);
  return (
    (inputTokens - cachedTokens) * rate.input
    + cachedTokens * rate.cachedInput
    + outputTokens * rate.output
  ) / TOKENS_PER_MILLION;
}

export function loadTokenCostDisplaySettings(): TokenCostDisplaySettings {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TOKEN_COST_DISPLAY_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_TOKEN_COST_DISPLAY_SETTINGS;
    }
    const value = parsed as Partial<TokenCostDisplaySettings>;
    const unit = typeof value.unit === "string" ? value.unit.trim().slice(0, 12) : "";
    const usdMultiplier = value.usdMultiplier;
    if (!unit || typeof usdMultiplier !== "number" || !Number.isFinite(usdMultiplier) || usdMultiplier <= 0) {
      return DEFAULT_TOKEN_COST_DISPLAY_SETTINGS;
    }
    return { unit, usdMultiplier };
  } catch {
    return DEFAULT_TOKEN_COST_DISPLAY_SETTINGS;
  }
}

export function saveTokenCostDisplaySettings(settings: TokenCostDisplaySettings) {
  window.localStorage.setItem(TOKEN_COST_DISPLAY_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(TOKEN_COST_DISPLAY_EVENT));
}

export function formatEstimatedCost(value: number, settings = DEFAULT_TOKEN_COST_DISPLAY_SETTINGS) {
  const converted = Number.isFinite(value) ? value * settings.usdMultiplier : 0;
  return `${converted < 0.01 && converted > 0 ? converted.toFixed(4) : converted.toFixed(2)} ${settings.unit}`;
}
