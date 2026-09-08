// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Account, Provider } from "../../types";
import { ProxyAccountPicker, type ProxyAccountPickerProps } from "./ProxyAccountPicker";
import { useUsageStatus } from "./useUsageStatus";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const account: Account = {
  id: "official", email: "user@example.com", group: "", note: "工作账号", expiresAt: "", plan: "Plus",
  privateDetails: { password: "", phoneNumber: "", totpSecret: "" }, active: true, autoSwitchEnabled: true,
  autoSwitchPriority: 0, autoSwitchThreshold: 0, localProxyCompatible: true, directSwitchCompatible: true,
  agentIdentity: false, official: true, metadataEditable: true, usage: {},
};
const provider: Provider = {
  id: "provider", kind: "custom", name: "测试 Provider", group: "", baseUrl: "https://example.com/v1",
  model: "test-model", models: [], modelReasoningEfforts: {}, modelContextWindows: {}, modelApiFormats: {},
  imageInputModels: [], imageInputModelsConfigured: false, modelSelectionControlledByCodex: true,
  fastModeEnabled: false, apiFormat: "openaiResponses", active: false, autoSwitchEnabled: false,
  hasApiKey: true, supportsDirectSwitch: false, balanceQueryUsesApiKey: true, hasBalanceQueryToken: false,
  hasWalletQueryToken: false, hasWalletLoginCredentials: false,
};
let root: Root;
let container: HTMLDivElement;
let props: ProxyAccountPickerProps;

function Fixture() {
  useUsageStatus(props.active);
  return <ProxyAccountPicker {...props} />;
}
const render = () => act(async () => root.render(<Fixture />));
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const option = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("section button"))
  .find((button) => button.textContent?.includes(text))!;
const click = (button: HTMLButtonElement) => act(async () => button.click());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  vi.mocked(invoke).mockReset().mockResolvedValue({ running: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = { active: true, accounts: [account], providers: [provider], aggregateApis: [], proxyRunning: true,
    busy: false, loading: false, onSwitchAccount: vi.fn().mockResolvedValue(true),
    onSwitchProvider: vi.fn().mockResolvedValue(true) };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows the selected proxy target and switches between providers and official accounts", async () => {
  await render();
  expect(trigger().textContent).toContain(account.email);
  await click(trigger());
  expect(option(account.email).getAttribute("aria-pressed")).toBe("true");
  await click(option(provider.name));
  expect(props.onSwitchProvider).toHaveBeenCalledWith(provider.id);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  // An active login account may coexist with a third-party proxy target.
  props.providers = [{ ...provider, active: true }];
  await render();
  expect(trigger().textContent).toContain(provider.name);
  await click(trigger());
  expect(option(account.email).getAttribute("aria-pressed")).toBe("false");
  await click(option(account.email));
  expect(props.onSwitchAccount).toHaveBeenCalledWith(account.id);
});

it.each([
  { label: "personal login", official: false, agentIdentity: false },
  { label: "pool account", official: true, agentIdentity: false },
  { label: "proxy-compatible agent account", official: false, agentIdentity: true },
])("shows and switches a $label regardless of account provenance", async ({ official, agentIdentity }) => {
  props.accounts = [{ ...account, official, agentIdentity }];
  await render();
  await click(trigger());
  expect(option(account.email).getAttribute("aria-pressed")).toBe("true");
  expect(option(account.email).disabled).toBe(false);

  props.providers = [{ ...provider, active: true }];
  await render();
  expect(option(account.email).getAttribute("aria-pressed")).toBe("false");
  await click(option(account.email));
  expect(props.onSwitchAccount).toHaveBeenCalledWith(account.id);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("keeps usage polling and the open list responsive while a switch is pending", async () => {
  let finish!: (success: boolean) => void;
  props.onSwitchProvider = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  await render();
  await click(trigger());
  await click(option(provider.name));
  await click(option(provider.name));
  expect(option(account.email).disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(invoke).toHaveBeenCalledTimes(6);
  expect(props.onSwitchProvider).toHaveBeenCalledOnce();
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  await act(async () => {
    document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  await act(async () => finish(true));
});

it("preserves selection on failure and allows retry without exposing internal errors", async () => {
  props.onSwitchProvider = vi.fn().mockRejectedValueOnce(new Error("private-path-secret"))
    .mockResolvedValueOnce(true);
  await render();
  await click(trigger());
  await click(option(provider.name));
  expect(trigger().textContent).toContain(account.email);
  expect(document.querySelector("[role=alert]")?.textContent).toBe("切换未完成，请重试。");
  expect(document.body.textContent).not.toContain("private-path-secret");
  await click(option(provider.name));
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("disables switching when the proxy is stopped or another operation is pending", async () => {
  props.proxyRunning = false;
  await render();
  await click(trigger());
  expect(document.body.textContent).toContain("开启本地代理后，即可在这里切换。");
  expect(option(provider.name).disabled).toBe(true);
  props.proxyRunning = true;
  props.busy = true;
  await render();
  await click(option(provider.name));
  expect(props.onSwitchProvider).not.toHaveBeenCalled();
  props.busy = false;
  props.accounts = [{ ...account, official: false, localProxyCompatible: false }];
  await render();
  expect(option(account.email).disabled).toBe(true);
});

it("tracks external selection updates and closes the list when leaving the page", async () => {
  await render();
  await click(trigger());
  props.providers = [{ ...provider, active: true }];
  await render();
  expect(trigger().textContent).toContain(provider.name);
  expect(option(provider.name).getAttribute("aria-pressed")).toBe("true");
  props.active = false;
  await render();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  const calls = vi.mocked(invoke).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(invoke).toHaveBeenCalledTimes(calls);
});
