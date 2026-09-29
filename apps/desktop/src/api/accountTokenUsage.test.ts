// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TokenUsageEntry } from "../types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("../utils/tokenCost", async (original) => ({
  ...await original<typeof import("../utils/tokenCost")>(),
  estimateTokenCost: (entry: TokenUsageEntry) => (entry.inputTokens ?? 0) / 1000,
}));

const entry: TokenUsageEntry = {
  id: "request-1", ts: 100, provider: "Official Codex", model: "test-model",
  accountId: "managed-1", accountEmail: "person@example.com", inputTokens: 800, outputTokens: 400,
  totalTokens: 1200, cachedTokens: 200, reasoningTokens: 50,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("__TAURI_INTERNALS__", {});
});
afterEach(() => vi.unstubAllGlobals());

it("derives tokens and cost from one snapshot, including records without an email", async () => {
  native.invoke.mockResolvedValue([entry, { ...entry, id: "request-2", accountEmail: null },
    { ...entry, id: "yesterday", ts: 99 },
    { ...entry, id: "provider", accountId: null, accountEmail: null },
  ]);
  const { loadAccountTokenUsage } = await import("./backend");
  await expect(loadAccountTokenUsage(100)).resolves.toEqual([{
    accountId: "managed-1", accountEmail: "person@example.com", totalTokens: 1200,
    inputTokens: 800, outputTokens: 400, cachedTokens: 200, reasoningTokens: 50, estimatedCost: 0.8,
  }, {
    accountId: "managed-1", accountEmail: null, totalTokens: 1200,
    inputTokens: 800, outputTokens: 400, cachedTokens: 200, reasoningTokens: 50, estimatedCost: 0.8,
  }]);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("list_token_usage_entries_since", { startTs: 100 });
});

it("retains email-only records and computes total tokens from input and output when needed", async () => {
  native.invoke.mockResolvedValue([{ ...entry, accountId: null, totalTokens: null }]);
  const { loadAccountTokenUsage } = await import("./backend");
  const totals = await loadAccountTokenUsage(100);
  expect(totals[0]).toMatchObject({ accountId: null, accountEmail: "person@example.com", totalTokens: 1200 });
});
