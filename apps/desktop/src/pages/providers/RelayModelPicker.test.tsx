// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Translate } from "../../i18n";
import { RelayModelPicker } from "./RelayModelPicker";
import { modelReasoningConfigs, type ModelReasoningConfig } from "./providerUtils";

const backend = vi.hoisted(() => ({ fetchRelayModels: vi.fn() }));
vi.mock("../../api/backend", () => backend);
vi.mock("antd", () => ({
  Button: ({ children, disabled, onClick }: {
    children: ReactNode; disabled: boolean; onClick: () => void;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  Select: () => null,
}));
vi.mock("./ModelReasoningEditor", () => ({ ModelReasoningEditor: () => null }));

let container: HTMLDivElement;
let root: Root;
const onModelConfigsChange = vi.fn();
const onActiveModelChange = vi.fn();
const t: Translate = (key) => key;
const existingConfigs = modelReasoningConfigs(["gpt-5.6-sol"], {
  reasoningEfforts: { "gpt-5.6-sol": ["high"] },
  contextWindows: { "gpt-5.6-sol": 400_000 },
  tokenCosts: { "gpt-5.6-sol": 2 },
});

function renderPicker(options: {
  providerId?: string; apiKey?: string; baseUrl?: string; modelConfigs?: ModelReasoningConfig[];
} = {}) {
  return act(async () => root.render(<RelayModelPicker
    baseUrl={options.baseUrl ?? "https://relay.example/v1"} apiKey={options.apiKey ?? ""}
    providerId={options.providerId} enabled disabled={false} modelConfigs={options.modelConfigs ?? existingConfigs}
    activeModel="gpt-5.6-sol" onModelConfigsChange={onModelConfigsChange}
    onActiveModelChange={onActiveModelChange} t={t} />));
}

async function refresh() {
  await act(async () => container.querySelector("button")!.click());
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it("refreshes with a saved key only on demand and preserves existing model settings", async () => {
  backend.fetchRelayModels.mockResolvedValue(["gpt-5.6-sol", "gpt-6-astra"]);
  await renderPicker({ providerId: "saved-provider" });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(backend.fetchRelayModels).not.toHaveBeenCalled();
  expect(container.querySelector("button")!.disabled).toBe(false);
  await refresh();
  expect(backend.fetchRelayModels).toHaveBeenCalledWith("https://relay.example/v1", "", "saved-provider");
  const configs = onModelConfigsChange.mock.calls[0][0];
  expect(configs[0]).toEqual(existingConfigs[0]);
  expect(configs[1].reasoningEfforts).toContain("ultra");
  expect(onActiveModelChange).toHaveBeenCalledWith("gpt-5.6-sol");
});

it("requires a key for a new connection and still automatically fetches after key entry", async () => {
  await renderPicker();
  expect(container.querySelector("button")!.disabled).toBe(true);
  backend.fetchRelayModels.mockResolvedValue(["gpt-6-astra"]);
  await renderPicker({ apiKey: "sk-new-test" });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(backend.fetchRelayModels).toHaveBeenCalledWith("https://relay.example/v1", "sk-new-test", undefined);
});

it("auto-fetches model defaults and keeps custom reasoning on repeated refreshes", async () => {
  const models = ["glm-5.3", "deepseek-v4-pro-0813", "kimi-k2.7-code", "qwen3.8-flash"];
  backend.fetchRelayModels.mockResolvedValue(models);
  await renderPicker({ apiKey: "sk-test", modelConfigs: [] });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  const fetched: ModelReasoningConfig[] = onModelConfigsChange.mock.calls[0][0];
  expect(fetched.map(({ reasoningEfforts }) => reasoningEfforts)).toEqual([
    ["low", "high", "max"], ["none", "low", "high", "max"],
    ["high"], ["none", "low", "medium", "xhigh"],
  ]);
  const edited = fetched.map((config): ModelReasoningConfig => ({
    ...config, reasoningEfforts: config.model === "glm-5.3" ? [] : ["medium", "ultra"],
  }));
  await renderPicker({ apiKey: "sk-test", modelConfigs: edited });
  await refresh();
  await refresh();
  expect(onModelConfigsChange.mock.calls.slice(1).map(([configs]) => configs)).toEqual([edited, edited]);
});

it("uses the latest user settings when an in-flight refresh finishes", async () => {
  let complete!: (models: string[]) => void;
  backend.fetchRelayModels.mockReturnValue(new Promise<string[]>((resolve) => { complete = resolve; }));
  await renderPicker({ providerId: "saved-provider" });
  await refresh();
  const edited = modelReasoningConfigs(["gpt-5.6-sol"], {
    reasoningEfforts: { "gpt-5.6-sol": ["none", "max"] },
  });
  await renderPicker({ providerId: "saved-provider", modelConfigs: edited });
  await act(async () => complete(["gpt-5.6-sol", "glm-5.3"]));
  expect(onModelConfigsChange.mock.calls[0][0][0]).toEqual(edited[0]);
});

it("keeps polling responsive during a request and avoids duplicate manual or automatic requests", async () => {
  let complete!: (models: string[]) => void;
  backend.fetchRelayModels.mockReturnValue(new Promise<string[]>((resolve) => { complete = resolve; }));
  await renderPicker({ apiKey: "sk-test" });
  const poll = vi.fn();
  const timer = window.setInterval(poll, 2000);
  await refresh();
  await refresh();
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(poll).toHaveBeenCalledTimes(2);
  expect(backend.fetchRelayModels).toHaveBeenCalledOnce();
  window.clearInterval(timer);
  await act(async () => complete(["gpt-6-astra"]));
  expect(onActiveModelChange).toHaveBeenCalledWith("gpt-6-astra");
});

it("preserves the model list on failure and allows retry", async () => {
  backend.fetchRelayModels.mockRejectedValueOnce(new Error("network unavailable"));
  await renderPicker({ providerId: "saved-provider" });
  await refresh();
  expect(onModelConfigsChange).not.toHaveBeenCalled();
  expect(container.textContent).toContain("providers.form.modelsFetchFailed");
  backend.fetchRelayModels.mockResolvedValue(["gpt-6-astra"]);
  await refresh();
  expect(onModelConfigsChange).toHaveBeenCalledOnce();
});

it("ignores a response after switching the saved provider", async () => {
  let complete!: (models: string[]) => void;
  backend.fetchRelayModels.mockReturnValue(new Promise<string[]>((resolve) => { complete = resolve; }));
  await renderPicker({ providerId: "first" });
  await refresh();
  await renderPicker({ providerId: "second" });
  await act(async () => complete(["stale-model"]));
  expect(onModelConfigsChange).not.toHaveBeenCalled();
});

it("ignores a response after closing the editor", async () => {
  let complete!: (models: string[]) => void;
  backend.fetchRelayModels.mockReturnValue(new Promise<string[]>((resolve) => { complete = resolve; }));
  await renderPicker({ providerId: "saved-provider" });
  await refresh();
  await act(async () => root.render(null));
  await act(async () => complete(["stale-model"]));
  expect(onModelConfigsChange).not.toHaveBeenCalled();
});
