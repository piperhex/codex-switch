import type { Translate, TranslationKey } from "../../i18n";
import type {
  ModelApiFormats,
  ModelContextWindows,
  ModelReasoningEfforts,
  ProviderApiFormat,
  ProviderBalancePlatform,
  ReasoningEffort,
} from "../../types";

const HIDDEN_COLUMNS_STORAGE_KEY = "codex-switch:provider-table-hidden-columns";

export const PROVIDER_TABLE_COLUMN_KEYS = [
  "provider",
  "group",
  "model",
  "api",
  "modelControl",
  "balance",
  "todayTokens",
  "totalTokens",
  "actions",
] as const;

export type ProviderTableColumnKey = typeof PROVIDER_TABLE_COLUMN_KEYS[number];

export const CONTEXT_WINDOW_OPTIONS = [128, 272, 384, 400, 1000].map((value) => ({
  label: `${value}K`,
  value: String(value),
}));

export const DEFAULT_CONTEXT_WINDOW_K = "256";
export const DEFAULT_DEEPSEEK_CONTEXT_WINDOW_K = "1000";

export function isProviderTableColumnKey(value: unknown): value is ProviderTableColumnKey {
  return typeof value === "string"
    && (PROVIDER_TABLE_COLUMN_KEYS as readonly string[]).includes(value);
}

export function loadHiddenColumns(): ProviderTableColumnKey[] {
  try {
    const stored = window.localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY) ?? "[]";
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(isProviderTableColumnKey))];
  } catch {
    return [];
  }
}

export function persistHiddenColumns(columns: ProviderTableColumnKey[]) {
  window.localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
}

export function normalizeModels(activeModel: string, values: string[]) {
  const models: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !models.includes(trimmed)) models.push(trimmed);
  };
  push(activeModel);
  values.forEach(push);
  return models;
}

export function modelOptions(models: string[]) {
  return models.map((model) => ({ label: model, value: model }));
}

export interface ModelReasoningConfig {
  model: string;
  reasoningEfforts: ReasoningEffort[];
  contextWindowK: string;
  apiFormat: ProviderApiFormat | "auto";
  supportsImageInput: boolean;
}

export const REASONING_EFFORTS: ReasoningEffort[] = [
  "none", "low", "medium", "high", "xhigh", "max", "ultra",
];

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, TranslationKey> = {
  none: "providers.reasoning.none",
  low: "providers.reasoning.low",
  medium: "providers.reasoning.medium",
  high: "providers.reasoning.high",
  xhigh: "providers.reasoning.xhigh",
  max: "providers.reasoning.max",
  ultra: "providers.reasoning.ultra",
};

export function defaultReasoningEfforts(model: string): ReasoningEffort[] {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return [];
  if (!normalized.startsWith("gpt-")) return ["none", "high"];
  const efforts: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
  if (normalized.startsWith("gpt-5.6")) efforts.push("max");
  if (normalized.startsWith("gpt-5.6-sol") || normalized.startsWith("gpt-5.6-terra")) {
    efforts.push("ultra");
  }
  return efforts;
}

export function supportsImageInputByDefault(model: string) {
  return model.trim().toLowerCase().startsWith("gpt-");
}

export function reasoningEffortOptions(model: string, t: Translate) {
  const values = model.trim().toLowerCase().startsWith("gpt-")
    ? defaultReasoningEfforts(model)
    : REASONING_EFFORTS;
  return values.map((value) => ({ label: t(REASONING_EFFORT_LABELS[value]), value }));
}

export function modelReasoningConfigs(
  models: string[],
  options: {
    reasoningEfforts?: ModelReasoningEfforts;
    contextWindows?: ModelContextWindows;
    apiFormats?: ModelApiFormats;
    fallbackContextWindow?: number | null;
    imageInputModels?: string[];
    preserveImageInputForModels?: string[];
  } = {},
): ModelReasoningConfig[] {
  const fallbackContextWindowK = options.fallbackContextWindow
    ? String(options.fallbackContextWindow / 1000)
    : DEFAULT_CONTEXT_WINDOW_K;
  return models.map((model) => ({
    model,
    reasoningEfforts: options.reasoningEfforts?.[model]?.length
      ? [...options.reasoningEfforts[model]]
      : defaultReasoningEfforts(model),
    contextWindowK: options.contextWindows?.[model]
      ? String(options.contextWindows[model] / 1000)
      : defaultContextWindowK(model, fallbackContextWindowK),
    apiFormat: options.apiFormats?.[model] ?? "auto",
    supportsImageInput: options.imageInputModels?.includes(model)
      || (!options.preserveImageInputForModels?.includes(model) && supportsImageInputByDefault(model)),
  }));
}

function defaultContextWindowK(model: string, fallbackContextWindowK: string) {
  if (model.trim().toLowerCase().startsWith("deepseek-")) {
    return DEFAULT_DEEPSEEK_CONTEXT_WINDOW_K;
  }
  return fallbackContextWindowK;
}

export function modelReasoningEfforts(configs: ModelReasoningConfig[]): ModelReasoningEfforts {
  return Object.fromEntries(configs.map(({ model, reasoningEfforts }) => [
    model.trim(),
    reasoningEfforts,
  ]).filter(([model]) => Boolean(model)));
}

export function modelContextWindows(configs: ModelReasoningConfig[]): ModelContextWindows {
  return Object.fromEntries(configs.flatMap(({ model, contextWindowK }) => {
    const contextWindow = parseContextWindowK(contextWindowK);
    return model.trim() && contextWindow ? [[model.trim(), contextWindow]] : [];
  }));
}

export function modelImageInputModels(configs: ModelReasoningConfig[]) {
  return configs
    .filter(({ model, supportsImageInput }) => model.trim() && supportsImageInput)
    .map(({ model }) => model.trim());
}

export function parseContextWindowK(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const contextWindowK = Number(trimmed);
  const contextWindow = contextWindowK * 1000;
  return Number.isSafeInteger(contextWindow) && contextWindowK > 0 ? contextWindow : undefined;
}

function relayRoot(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/v1$/i, "");
  }
}

export function relayApiUrl(value: string) {
  const root = relayRoot(value);
  return root ? `${root}/v1` : "";
}

export function defaultBalanceUrl(value: string, platform: ProviderBalancePlatform) {
  const root = relayRoot(value);
  if (!root) return "";
  if (platform === "newApi") return `${root}/api/usage/token/`;
  if (platform === "deepSeek") return `${root}/user/balance`;
  return `${root}/v1/usage`;
}

export function defaultWalletUrl(value: string, platform: ProviderBalancePlatform) {
  const root = relayRoot(value);
  if (!root) return "";
  return platform === "newApi" ? `${root}/api/user/self` : `${root}/api/v1/user/profile`;
}

export function relayName(value: string) {
  try {
    return new URL(relayRoot(value)).hostname;
  } catch {
    return "";
  }
}

export function modelApiFormats(configs: ModelReasoningConfig[]): ModelApiFormats {
  return Object.fromEntries(configs.flatMap(({ model, apiFormat }) => (
    model.trim() && apiFormat !== "auto" ? [[model.trim(), apiFormat]] : []
  )));
}
