import type { Translate } from "../../i18n";
import type { ProviderBalancePlatform } from "../../types";

const HIDDEN_COLUMNS_STORAGE_KEY = "codex-switch:provider-table-hidden-columns";

export const PROVIDER_TABLE_COLUMN_KEYS = [
  "provider",
  "model",
  "api",
  "modelControl",
  "balance",
  "todayTokens",
  "totalTokens",
  "actions",
] as const;

export type ProviderTableColumnKey = typeof PROVIDER_TABLE_COLUMN_KEYS[number];

export const CONTEXT_WINDOW_OPTIONS = [128, 256, 400, 1000].map((value) => ({
  label: `${value}K`,
  value: String(value),
}));

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

export function balancePlatformOptions(t: Translate, includeDisabled = true) {
  const options: { label: string; value: ProviderBalancePlatform | "none" }[] = [];
  if (includeDisabled) options.push({ label: t("providers.balance.disabled"), value: "none" });
  options.push(
    { label: "New API", value: "newApi" },
    { label: "Sub2API", value: "sub2Api" },
  );
  return options;
}
