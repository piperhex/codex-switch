import type { Provider, TokenUsageEntry } from "../types";

const TOKENS_PER_MILLION = 1_000_000;
const TOKEN_COST_DISPLAY_STORAGE_KEY = "codex-switch:token-cost-display";
const TOKEN_COST_CUSTOM_RULES_STORAGE_KEY = "codex-switch:token-cost-custom-rules";
export const TOKEN_COST_DISPLAY_EVENT = "codex-switch:token-cost-display-changed";
export const TOKEN_COST_CUSTOM_RULES_EVENT = "codex-switch:token-cost-custom-rules-changed";

export interface TokenCostDisplaySettings {
  unit: string;
  usdMultiplier: number;
}

export const DEFAULT_TOKEN_COST_DISPLAY_SETTINGS: TokenCostDisplaySettings = {
  unit: "USD",
  usdMultiplier: 1,
};

export interface TokenCostRate {
  input: number;
  cachedInput: number;
  output: number;
}

export interface CustomTokenCostRule extends TokenCostRate {
  providerId: string;
  model: string;
}

let cachedCustomTokenCostRules: CustomTokenCostRule[] | null = null;

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
  "gpt-5.6": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
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

function matchesModel(configuredModel: string, entryModel: string) {
  const configured = configuredModel.trim().toLowerCase();
  const model = entryModel.trim().toLowerCase();
  return model === configured || model.startsWith(`${configured}-`);
}

function customRateForEntry(
  entry: TokenUsageEntry,
  provider: Provider | undefined,
  rules: CustomTokenCostRule[],
) {
  const providerId = provider?.id ?? entry.providerId;
  if (!providerId) return undefined;
  return rules.find((rule) => rule.providerId === providerId && matchesModel(rule.model, entry.model));
}

function rateForEntry(
  entry: TokenUsageEntry,
  providers: Provider[],
  customRules: CustomTokenCostRule[],
): TokenCostRate {
  const provider = providerForEntry(entry, providers);
  const customRate = customRateForEntry(entry, provider, customRules);
  if (customRate) return customRate;
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
  const rate = rateForEntry(entry, providers, loadCustomTokenCostRules());
  return (
    (inputTokens - cachedTokens) * rate.input
    + cachedTokens * rate.cachedInput
    + outputTokens * rate.output
  ) / TOKENS_PER_MILLION;
}

export function loadCustomTokenCostRules(): CustomTokenCostRule[] {
  if (cachedCustomTokenCostRules) return cachedCustomTokenCostRules;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TOKEN_COST_CUSTOM_RULES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    cachedCustomTokenCostRules = parsed.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const rule = value as Partial<CustomTokenCostRule>;
      const providerId = typeof rule.providerId === "string" ? rule.providerId.trim() : "";
      const model = typeof rule.model === "string" ? rule.model.trim() : "";
      const rates = [rule.input, rule.cachedInput, rule.output];
      if (!providerId || !model || rates.some((rate) => (
        typeof rate !== "number" || !Number.isFinite(rate) || rate < 0
      ))) return [];
      return [{ providerId, model, input: rule.input!, cachedInput: rule.cachedInput!, output: rule.output! }];
    });
    return cachedCustomTokenCostRules;
  } catch {
    return [];
  }
}

export function saveCustomTokenCostRules(rules: CustomTokenCostRule[]) {
  const normalized = rules
    .map((rule) => ({
      providerId: rule.providerId.trim(),
      model: rule.model.trim(),
      input: rule.input,
      cachedInput: rule.cachedInput,
      output: rule.output,
    }))
    .filter((rule) => rule.providerId && rule.model && [rule.input, rule.cachedInput, rule.output]
      .every((rate) => Number.isFinite(rate) && rate >= 0));
  window.localStorage.setItem(TOKEN_COST_CUSTOM_RULES_STORAGE_KEY, JSON.stringify(normalized));
  cachedCustomTokenCostRules = normalized;
  window.dispatchEvent(new CustomEvent(TOKEN_COST_CUSTOM_RULES_EVENT));
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
