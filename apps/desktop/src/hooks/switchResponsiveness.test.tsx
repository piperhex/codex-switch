// @vitest-environment jsdom
import { act } from "react";
import { ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as backend from "../api/backend";
import { DEMO_ACCOUNTS, DEMO_INFO } from "../demo";
import type { Translate } from "../i18n";
import type { Provider } from "../types";
import { ProxySessionManager } from "../components/ProxySessionManager";
import { useAccountManager } from "./useAccountManager";
import { useProviderManager } from "./useProviderManager";

vi.mock("../api/backend", async (importOriginal) => ({
  ...await importOriginal<typeof backend>(),
  hasLocalBackend: true,
  activateAccount: vi.fn(), deactivateAccount: vi.fn(), activateProvider: vi.fn(),
  switchProviderModel: vi.fn(), queryProviderBalance: vi.fn(), loadDashboard: vi.fn(),
  loadProviders: vi.fn(), loadAggregateApis: vi.fn(), loadLocalProxyStatus: vi.fn(),
  loadProxySessions: vi.fn(), loadProxySessionUnlimitedConversation: vi.fn(),
  subscribeToBackendEvents: vi.fn(() => () => undefined),
  subscribeToProviderEvents: vi.fn(() => () => undefined),
}));

const provider: Provider = {
  id: "provider", kind: "custom", name: "Provider", group: "", baseUrl: "https://example.com",
  model: "model", models: ["model"], modelReasoningEfforts: {}, modelContextWindows: {}, modelApiFormats: {},
  imageInputModels: [], imageInputModelsConfigured: false, modelSelectionControlledByCodex: false,
  fastModeEnabled: false, apiFormat: "openaiResponses", active: false, autoSwitchEnabled: true,
  hasApiKey: true, supportsDirectSwitch: false, balancePlatform: "newApi", balanceQueryUsesApiKey: true,
  hasBalanceQueryToken: false, hasWalletQueryToken: false, hasWalletLoginCredentials: false,
};
const notify = vi.fn();
const t: Translate = (key) => key;
const cloudSync = { pushAccount: vi.fn(), pushProvider: vi.fn() };
let root: Root;
let container: HTMLDivElement;
let accounts: ReturnType<typeof useAccountManager>;
let providers: ReturnType<typeof useProviderManager>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function Fixture() {
  accounts = useAccountManager(notify, t, cloudSync);
  providers = useProviderManager(notify, t, cloudSync);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  vi.mocked(backend.loadDashboard).mockResolvedValue({ accounts: DEMO_ACCOUNTS, info: DEMO_INFO });
  vi.mocked(backend.loadProviders).mockResolvedValue([provider]);
  vi.mocked(backend.loadAggregateApis).mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("finishes official switches and allows another switch while cloud uploads are pending", async () => {
  const upload = deferred<void>();
  cloudSync.pushAccount.mockReturnValue(upload.promise);
  let result: boolean | undefined;
  await act(async () => { void accounts.switchAccount("first", true).then((value) => { result = value; }); });
  expect(result).toBe(true);
  expect(accounts.busyAccountId).toBeNull();
  expect(cloudSync.pushAccount).toHaveBeenCalledWith("first");
  await act(async () => { void accounts.switchAccount("second", true); });
  expect(backend.activateAccount).toHaveBeenLastCalledWith("second");
  expect(accounts.busyAccountId).toBeNull();
  await act(async () => upload.resolve());
});

it("keeps local switching busy until activation and the refreshed state complete", async () => {
  const activation = deferred<void>();
  const snapshot = deferred<Awaited<ReturnType<typeof backend.loadDashboard>>>();
  vi.mocked(backend.activateAccount).mockReturnValue(activation.promise);
  vi.mocked(backend.loadDashboard).mockReturnValue(snapshot.promise);
  await act(async () => { void accounts.switchAccount("first"); });
  expect(accounts.busyAccountId).toBe("first");
  expect(cloudSync.pushAccount).not.toHaveBeenCalled();
  await act(async () => activation.resolve());
  expect(accounts.busyAccountId).toBe("first");
  await act(async () => snapshot.resolve({ accounts: DEMO_ACCOUNTS, info: DEMO_INFO }));
  expect(accounts.busyAccountId).toBeNull();
  expect(cloudSync.pushAccount).toHaveBeenCalledWith("first");
});

it("finishes deactivation and provider model changes before their uploads settle", async () => {
  const upload = deferred<void>();
  cloudSync.pushAccount.mockReturnValue(upload.promise);
  cloudSync.pushProvider.mockReturnValue(upload.promise);
  let deactivated = false;
  let modelChanged = false;
  await act(async () => {
    void accounts.deactivateAccount("first").then(() => { deactivated = true; });
    void providers.switchModel(provider.id, "next").then(() => { modelChanged = true; });
  });
  expect(deactivated).toBe(true);
  expect(modelChanged).toBe(true);
  expect(accounts.busyAccountId).toBeNull();
  expect(providers.busyProviderId).toBeNull();
  expect(cloudSync.pushProvider).toHaveBeenCalledWith(provider.id);
  await act(async () => upload.resolve());
});

it("finishes provider switching while its balance request is still active", async () => {
  const balance = deferred<Awaited<ReturnType<typeof backend.queryProviderBalance>>>();
  vi.mocked(backend.queryProviderBalance).mockReturnValue(balance.promise);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  let result: boolean | undefined;
  await act(async () => { void providers.switchProvider(provider.id).then((value) => { result = value; }); });
  expect(result).toBe(true);
  expect(providers.busyProviderId).toBeNull();
  expect(backend.queryProviderBalance).toHaveBeenCalledWith(provider.id);
  notify.mockClear();
  await act(async () => balance.reject(new Error("balance offline")));
  expect(notify).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledOnce();
});

it.each([false, true])("does not turn a completed switch into a cloud failure (sync throw: %s)", async (syncThrow) => {
  const error = new Error("cloud offline");
  cloudSync.pushAccount.mockImplementation(() => {
    if (syncThrow) throw error;
    return Promise.reject(error);
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await act(async () => { expect(await accounts.switchAccount("first", true)).toBe(true); });
  expect(accounts.busyAccountId).toBeNull();
  expect(notify).toHaveBeenCalledExactlyOnceWith("toast.accountSwitchedHot");
  expect(warning).toHaveBeenCalledWith("Account switch follow-up failed", error);
});

it("reports local activation failures without starting follow-up requests", async () => {
  vi.mocked(backend.activateAccount).mockRejectedValue(new Error("activation failed"));
  vi.mocked(backend.activateProvider).mockRejectedValue(new Error("activation failed"));
  await act(async () => {
    expect(await accounts.switchAccount("first")).toBe(false);
    expect(await providers.switchProvider(provider.id)).toBe(false);
  });
  expect(cloudSync.pushAccount).not.toHaveBeenCalled();
  expect(backend.queryProviderBalance).not.toHaveBeenCalled();
  expect(accounts.busyAccountId).toBeNull();
  expect(providers.busyProviderId).toBeNull();
});

it("keeps the open session view polling and closable while switch follow-ups remain pending", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  vi.mocked(backend.loadProxySessionUnlimitedConversation).mockResolvedValue(false);
  vi.mocked(backend.loadProxySessions).mockResolvedValue([{
    id: "active", client: "codex_switch_gui", connectedAt: 1, lastSeenAt: 1,
    activeRequests: 1, requestCount: 1, totalTokens: 0, inputTokens: 0,
    outputTokens: 0, reasoningTokens: 0, cachedTokens: 0,
  }]);
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <Fixture /><ProxySessionManager t={t} />
  </ConfigProvider>));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(backend.loadProxySessions).toHaveBeenCalledOnce();
  const upload = deferred<void>();
  const balance = deferred<Awaited<ReturnType<typeof backend.queryProviderBalance>>>();
  cloudSync.pushAccount.mockReturnValue(upload.promise);
  vi.mocked(backend.queryProviderBalance).mockReturnValue(balance.promise);
  await act(async () => {
    void accounts.switchAccount("first", true);
    void providers.switchProvider(provider.id);
  });
  expect(accounts.busyAccountId).toBeNull();
  expect(providers.busyProviderId).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(backend.loadProxySessions).toHaveBeenCalledTimes(4);
  const close = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "providers.proxy.sessionsClose")!;
  await act(async () => close.click());
  expect(document.querySelector<HTMLElement>(".ant-modal-wrap")?.style.display).toBe("none");
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(backend.loadProxySessions).toHaveBeenCalledTimes(4);
  await act(async () => {
    upload.resolve();
    balance.resolve({ apiUnit: "USD", apiUnlimited: false, walletUnit: "USD", queriedAt: 1 });
  });
});
