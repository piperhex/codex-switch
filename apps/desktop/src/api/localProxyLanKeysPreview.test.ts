// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { previewCopyLocalProxyLanApiKey, previewDeleteLocalProxyLanApiKey, previewHasLocalProxyLanApiKey,
  previewLocalProxyLanApiKeys, previewSaveLocalProxyLanApiKey,
  previewSetLegacyLanApiKey } from "./localProxyLanKeysPreview";

beforeEach(() => { localStorage.clear(); });

it("migrates the old key and does not restore it after deletion", () => {
  localStorage.setItem("codex-switch:local-proxy-lan-api-key", "existing-key");
  const [migrated] = previewLocalProxyLanApiKeys();
  expect(migrated).toMatchObject({ enabled: true, quotaUsd: null, usedTokens: 0 });
  expect(migrated).not.toHaveProperty("apiKey");
  expect(previewHasLocalProxyLanApiKey()).toBe(true);
  previewDeleteLocalProxyLanApiKey(migrated.id);
  expect(previewLocalProxyLanApiKeys()).toEqual([]);
  expect(previewHasLocalProxyLanApiKey()).toBe(false);
});

it("generates distinct keys, copies the selected one, and preserves it when editing a limit", async () => {
  const [first] = previewSaveLocalProxyLanApiKey({ name: "First", enabled: true, quotaUsd: null });
  const [, second] = previewSaveLocalProxyLanApiKey({ name: "Second", enabled: true,
    apiKey: "custom-key-123456789", quotaUsd: 12.5 });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await previewCopyLocalProxyLanApiKey(first.id);
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^cs_[a-f0-9]{48}$/));
  previewSaveLocalProxyLanApiKey({ id: second.id, name: "Renamed", enabled: true, quotaUsd: 20 });
  await previewCopyLocalProxyLanApiKey(second.id);
  expect(writeText).toHaveBeenLastCalledWith("custom-key-123456789");
  expect(previewLocalProxyLanApiKeys()[1]).toMatchObject({ remainingUsd: 20, name: "Renamed" });
});

it("keeps the old settings flow compatible and excludes disabled keys from LAN readiness", () => {
  previewSetLegacyLanApiKey("legacy-custom-key-123456789");
  const [key] = previewLocalProxyLanApiKeys();
  previewSaveLocalProxyLanApiKey({ id: key.id, name: key.name, enabled: false, quotaUsd: null });
  expect(previewHasLocalProxyLanApiKey()).toBe(false);
  previewSetLegacyLanApiKey("replacement-key-123456789");
  expect(previewLocalProxyLanApiKeys()).toHaveLength(1);
  expect(previewHasLocalProxyLanApiKey()).toBe(true);
});

it("clears incomplete usage only after an explicit acknowledgment", () => {
  const [key] = previewSaveLocalProxyLanApiKey({ name: "First", enabled: true, quotaUsd: 10 });
  const raw = JSON.parse(localStorage.getItem("codex-switch:local-proxy-lan-api-keys")!) as Record<string, unknown>[];
  raw[0].usageIncomplete = true;
  localStorage.setItem("codex-switch:local-proxy-lan-api-keys", JSON.stringify(raw));
  const input = { id: key.id, name: "Renamed", enabled: true, quotaUsd: 20 };
  expect(previewSaveLocalProxyLanApiKey(input)[0].usageIncomplete).toBe(true);
  expect(previewSaveLocalProxyLanApiKey({ ...input, acknowledgeUsage: true })[0].usageIncomplete).toBe(false);
});
