import { expect, it } from "vitest";
import type { AggregateApi, Provider } from "../../types";
import { providerModels } from "./providerModels";

const provider: Provider = {
  id: "relay", kind: "custom", name: "Relay", group: "", baseUrl: "https://example.com/v1",
  model: "deepseek-v3", models: ["deepseek-v3", "kimi-k3", "kimi-k3"],
  modelReasoningEfforts: { "kimi-k3": ["low", "high", "max"] }, modelContextWindows: {}, modelApiFormats: {},
  imageInputModels: [], imageInputModelsConfigured: false, modelSelectionControlledByCodex: true,
  fastModeEnabled: false, apiFormat: "openaiResponses", active: true, autoSwitchEnabled: false,
  hasApiKey: true, supportsDirectSwitch: false, balanceQueryUsesApiKey: true, hasBalanceQueryToken: false,
  hasWalletQueryToken: false, hasWalletLoginCredentials: false,
};

it("uses only the active third-party catalog and its configured reasoning levels", () => {
  const models = providerModels([{ ...provider, id: "inactive", active: false }, provider], [])!;
  expect(models.map((entry) => entry.model)).toEqual(["deepseek-v3", "kimi-k3"]);
  expect(models[0].isDefault).toBe(true);
  expect(models[1].supportedReasoningEfforts.map((entry) => entry.reasoningEffort)).toEqual(["low", "high", "max"]);
  expect(models[1].defaultReasoningEffort).toBe("high");
});

it("shows only the model that a fixed Provider actually forwards to", () => {
  expect(providerModels([{ ...provider, modelSelectionControlledByCodex: false }], [])?.map((entry) => entry.model))
    .toEqual(["deepseek-v3"]);
});

it("keeps the live Codex catalog for official accounts and upstream Codex Switch Providers", () => {
  expect(providerModels([], [])).toBeNull();
  expect(providerModels([{ ...provider, active: false }], [])).toBeNull();
  expect(providerModels([{ ...provider, kind: "openai" }], [])).toBeNull();
});

it("keeps an empty third-party catalog separate from the account catalog", () => {
  expect(providerModels([{ ...provider, model: "", models: [] }], [])).toEqual([]);
});

it("uses the aggregate's fixed model and reasoning supported by all members", () => {
  const aggregate: AggregateApi = { id: "aggregate", name: "Pool", model: "kimi-k3",
    memberProviderIds: ["relay", "second"], enabled: true, active: true, memberConversationCounts: {} };
  const models = providerModels([provider, { ...provider, id: "second", active: false,
    modelReasoningEfforts: { "kimi-k3": ["high"] } }], [aggregate])!;
  expect(models.map((entry) => entry.model)).toEqual(["kimi-k3"]);
  expect(models[0].supportedReasoningEfforts).toEqual([{ reasoningEffort: "high", description: "" }]);
});
