// @vitest-environment jsdom
import { act } from "react";
import { ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadLocalProxyIpv4Addresses } from "../../api/proxyEndpoints";
import { loadProxySessions } from "../../api/backend";
import type { LocalProxyStatus, ProxySession } from "../../types";
import { ProxySessionManager } from "../ProxySessionManager";
import { ProxySettingsModal } from "./ProxySettingsModal";

vi.mock("../../api/proxyEndpoints", () => ({
  LOOPBACK_IPV4: "127.0.0.1",
  loadLocalProxyIpv4Addresses: vi.fn(),
}));
vi.mock("../../api/backend", () => ({
  loadProxySessions: vi.fn(),
  loadProxySessionUnlimitedConversation: vi.fn().mockResolvedValue(false),
  loadProxySessionRequests: vi.fn().mockResolvedValue([]),
  setProxySessionUnlimitedConversation: vi.fn(),
}));

const proxy: LocalProxyStatus = {
  running: true, fastModeEnabled: false, fastModeAvailable: true,
  address: "127.0.0.1", port: 15722, baseUrl: "http://127.0.0.1:15722",
  autoSwitchOnQuotaExhaustion: false, concurrentAccountRoutingEnabled: false,
  customAutoSwitchPriorityEnabled: false, customAutoSwitchThresholdEnabled: false,
  globalAutoSwitchThreshold: 0, autoDisableUnreachableAccounts: false,
  systemPromptFilterEnabled: false, systemPromptFilterRules: [],
  systemPromptInjectionEnabled: false, systemPromptInjectionPrompts: [],
  listenOnAllInterfaces: false, hasLanApiKey: false,
};
const session: ProxySession = {
  id: "active-session", client: "codex_switch_gui", connectedAt: 1, lastSeenAt: 1,
  activeRequests: 1, requestCount: 1, totalTokens: 0, inputTokens: 0,
  outputTokens: 0, reasoningTokens: 0, cachedTokens: 0,
};
const onSave = vi.fn<(enabled: boolean, key?: string) => Promise<boolean>>();
const onCopyApiKey = vi.fn<() => Promise<void>>();
const onClose = vi.fn();
const notify = vi.fn();
const writeText = vi.fn();
const t = (key: string) => key;
let root: Root;
let container: HTMLDivElement;

function button(key: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent === key || entry.getAttribute("aria-label") === key);
  if (!result) throw new Error(`Missing button: ${key}`);
  return result;
}
const keyInput = () => document.querySelector<HTMLInputElement>("#local-proxy-api-key")!;

async function render(overrides: Partial<LocalProxyStatus> = {}, open = true) {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <ProxySessionManager t={t} />
    <ProxySettingsModal open={open} proxy={{ ...proxy, ...overrides }} loading={false}
      onSave={onSave} onCopyApiKey={onCopyApiKey} onClose={onClose} notify={notify} t={t} />
  </ConfigProvider>));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
  onSave.mockResolvedValue(true);
  onCopyApiKey.mockResolvedValue(undefined);
  vi.mocked(loadLocalProxyIpv4Addresses).mockReset().mockResolvedValue(["127.0.0.1", "192.168.1.8"]);
  vi.mocked(loadProxySessions).mockResolvedValue([session]);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("saves a generated key before allowing LAN access and copies the saved key after reopening", async () => {
  await render({}, false);
  expect(loadLocalProxyIpv4Addresses).not.toHaveBeenCalled();
  await render();
  expect(button("providers.proxy.listenLan").disabled).toBe(true);
  await act(async () => button("providers.proxy.generateApiKey").click());
  const generated = keyInput().value;
  expect(generated).toMatch(/^cs_[a-f0-9]{48}$/);
  expect(onSave).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("providers.proxy.apiKeyUnsaved");
  await act(async () => button("providers.proxy.copyLanApiKey").click());
  expect(writeText).toHaveBeenCalledWith(generated);
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(onSave).toHaveBeenCalledWith(false, generated);
  expect(keyInput().value).toBe("");
  await render({ hasLanApiKey: true });
  await act(async () => button("providers.proxy.listenLan").click());
  expect(onSave).toHaveBeenLastCalledWith(true, undefined);
  await render({ hasLanApiKey: true, listenOnAllInterfaces: true }, false);
  await render({ hasLanApiKey: true, listenOnAllInterfaces: true });
  await act(async () => button("providers.proxy.copyLanApiKey").click());
  expect(onCopyApiKey).toHaveBeenCalledOnce();
});

it("retains the new key after a failed update and prevents overlapping saves", async () => {
  await render({ hasLanApiKey: true, listenOnAllInterfaces: true });
  await act(async () => button("providers.proxy.generateApiKey").click());
  const generated = keyInput().value;
  let completeSave!: (success: boolean) => void;
  onSave.mockImplementationOnce(() => new Promise((resolve) => { completeSave = resolve; }));
  await act(async () => {
    button("providers.proxy.updateApiKey").click();
    button("providers.proxy.updateApiKey").click();
  });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith(true, generated);
  expect(button("providers.proxy.listenLan").disabled).toBe(true);
  await act(async () => completeSave(false));
  expect(keyInput().value).toBe(generated);
  expect(button("providers.proxy.listenLan").getAttribute("aria-checked")).toBe("true");
  await act(async () => button("providers.proxy.updateApiKey").click());
  expect(keyInput().value).toBe("");
});

it("copies each endpoint and keeps the local endpoint available when address loading fails", async () => {
  await render();
  await act(async () => button("providers.proxy.copyEndpoint: http://192.168.1.8:15722/v1").click());
  expect(writeText).toHaveBeenLastCalledWith("http://192.168.1.8:15722/v1");
  await render({}, false);
  vi.mocked(loadLocalProxyIpv4Addresses).mockRejectedValueOnce(new Error("scan failed"));
  await render();
  expect(document.body.textContent).toContain("providers.proxy.addressesFailed");
  await act(async () => button("providers.proxy.copyEndpoint: http://127.0.0.1:15722/v1").click());
  expect(writeText).toHaveBeenLastCalledWith("http://127.0.0.1:15722/v1");
});

it("stays interactive while an active session poll and address scan are pending", async () => {
  await render({}, false);
  await act(async () => button("providers.proxy.sessions").click());
  let completePoll!: (sessions: ProxySession[]) => void;
  vi.mocked(loadProxySessions).mockImplementationOnce(() => new Promise((resolve) => { completePoll = resolve; }));
  await act(async () => vi.advanceTimersByTime(2_000));
  let completeScan!: (addresses: string[]) => void;
  vi.mocked(loadLocalProxyIpv4Addresses).mockImplementationOnce(() => new Promise((resolve) => {
    completeScan = resolve;
  }));
  await render();
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(loadProxySessions).toHaveBeenCalledTimes(2);
  await act(async () => button("providers.proxy.generateApiKey").click());
  expect(keyInput().value).toMatch(/^cs_/);
  await act(async () => document.querySelector<HTMLButtonElement>(".proxy-settings-modal .ant-modal-close")!.click());
  expect(onClose).toHaveBeenCalledOnce();
  await render({}, false);
  await render();
  expect(loadLocalProxyIpv4Addresses).toHaveBeenCalledTimes(1);
  await act(async () => {
    completeScan(["192.168.1.8"]);
    completePoll([session]);
  });
  expect(document.body.textContent).toContain("http://192.168.1.8:15722/v1");
});
