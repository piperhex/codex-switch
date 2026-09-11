import type { LocalProxyLanApiKey, LocalProxyLanApiKeyInput } from "../types";

const STORAGE_KEY = "codex-switch:local-proxy-lan-api-keys";
const LEGACY_STORAGE_KEY = "codex-switch:local-proxy-lan-api-key";
const DEFAULT_KEY_ID = "legacy";
const API_KEY_RANDOM_BYTES = 24;

interface PreviewKey extends LocalProxyLanApiKey { apiKey: string }

export function generateLocalProxyLanApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES));
  return `cs_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function readKeys(): PreviewKey[] {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed as PreviewKey[];
    } catch { /* Discard malformed preview data and recover the legacy key if available. */ }
  }
  const apiKey = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  return apiKey ? [{ id: DEFAULT_KEY_ID, name: "Default", apiKey, keyPreview: maskKey(apiKey), enabled: true,
    quotaUsd: null, usedTokens: 0, usedCostUsd: 0, remainingUsd: null }] : [];
}

function maskKey(apiKey: string): string {
  return apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : "••••••••";
}

function writeKeys(keys: PreviewKey[]): LocalProxyLanApiKey[] {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  return previewLocalProxyLanApiKeys();
}

export function previewLocalProxyLanApiKeys(): LocalProxyLanApiKey[] {
  return readKeys().map(({ apiKey: _apiKey, ...key }) => key);
}

export function previewHasLocalProxyLanApiKey(): boolean {
  return readKeys().some((key) => key.enabled);
}

export function previewSaveLocalProxyLanApiKey(input: LocalProxyLanApiKeyInput): LocalProxyLanApiKey[] {
  const keys = readKeys();
  const current = input.id ? keys.find((key) => key.id === input.id) : undefined;
  if (input.id && !current) throw new Error("Key not found");
  const apiKey = input.apiKey?.trim() || current?.apiKey || generateLocalProxyLanApiKey();
  if (keys.some((key) => key.id !== current?.id && key.apiKey === apiKey)) throw new Error("Duplicate key");
  const usedCostUsd = current?.usedCostUsd ?? 0;
  const saved: PreviewKey = { id: current?.id ?? crypto.randomUUID(), name: input.name.trim(),
    apiKey, keyPreview: maskKey(apiKey), enabled: input.enabled, quotaUsd: input.quotaUsd,
    usedTokens: current?.usedTokens ?? 0, usedCostUsd,
    usageIncomplete: input.acknowledgeUsage ? false : current?.usageIncomplete ?? false,
    remainingUsd: input.quotaUsd === null ? null : Math.max(0, input.quotaUsd - usedCostUsd) };
  return writeKeys(current ? keys.map((key) => key.id === current.id ? saved : key) : [...keys, saved]);
}

export function previewDeleteLocalProxyLanApiKey(id: string): LocalProxyLanApiKey[] {
  return writeKeys(readKeys().filter((key) => key.id !== id));
}

export async function previewCopyLocalProxyLanApiKey(id?: string): Promise<void> {
  const keys = readKeys();
  const key = id ? keys.find((entry) => entry.id === id) : keys.find((entry) => entry.enabled);
  if (!key) throw new Error("Key not found");
  await navigator.clipboard.writeText(key.apiKey);
}

export function previewSetLegacyLanApiKey(apiKey: string): void {
  const keys = readKeys();
  const current = keys.find((key) => key.id === DEFAULT_KEY_ID) ?? keys[0];
  previewSaveLocalProxyLanApiKey({ id: current?.id, name: current?.name ?? "Default", apiKey,
    enabled: true, quotaUsd: current?.quotaUsd ?? null });
}
