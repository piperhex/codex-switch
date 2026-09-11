// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { DEMO_ACCOUNTS } from "../../demo";
import { GuiAutoSwitchSettingsDialog } from "./GuiAutoSwitchSettingsDialog";
import type { GuiAutoSwitchSettings } from "./autoSwitchSettings";

vi.mock("../../api/backend", () => ({ invoke: vi.fn() }));
const account = { ...DEMO_ACCOUNTS[0], id: "gui-account", email: "gui@example.com", localProxyCompatible: true,
  autoSwitchEnabled: false, autoSwitchPriority: 55, autoSwitchThreshold: 60 };
const defaults: GuiAutoSwitchSettings = { enabled: false, switchOnQuotaExhaustion: true,
  minimumRemainingPercent: 0, mode: "sequential", fallbackProviderId: null, accounts: [] };
const providers = [{ id: "backup", name: "备用服务" }];
const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
let root: Root;
let container: HTMLDivElement;
let onClose: () => void;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const footerButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".ant-modal-footer button")]
  .find((entry) => entry.textContent?.replace(/ /g, "") === label)!;
const click = (element: HTMLElement) => act(async () => element.click());
const render = (privacyMode = false) => act(async () => root.render(
  <GuiAutoSwitchSettingsDialog accounts={[account]} providers={providers}
    privacyMode={privacyMode} onClose={onClose} />));

async function typeNumber(label: string, value: string) {
  await act(async () => {
    nativeValueSetter.call(input(label), value);
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function chooseOption(label: string, value: string) {
  await act(async () => input(label).dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")]
    .find((entry) => entry.textContent === value)!;
  await click(option);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  vi.mocked(invoke).mockReset().mockResolvedValue(defaults);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onClose = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("loads GUI rules independently and saves participation, priority and thresholds together", async () => {
  await render();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("codex_gui_auto_switch_settings");
  expect(document.querySelector<HTMLElement>(".ant-modal")?.style.width).toBe("80vw");
  expect(button(`${account.email} 参与自动切换`).getAttribute("aria-checked")).toBe("true");
  expect(input(`${account.email} 优先级`).value).toBe("0");
  expect(Number(input(`${account.email} 剩余阈值`).value)).toBe(0);
  expect(input("默认剩余额度阈值").disabled).toBe(true);
  await click(button("自动切换账号"));
  await click(button("额度耗尽后切换"));
  await typeNumber("默认剩余额度阈值", "12.5");
  await typeNumber(`${account.email} 优先级`, "-5");
  await typeNumber(`${account.email} 剩余阈值`, "25");
  await click(button(`${account.email} 参与自动切换`));
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_auto_switch_settings", { settings: {
    ...defaults, enabled: true, switchOnQuotaExhaustion: false, minimumRemainingPercent: 12.5,
    accounts: [{ accountId: account.id, enabled: false, priority: -5, thresholdPercent: 25 }],
  } });
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps edited values after save failure and retries without exposing internal errors", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ ...defaults, enabled: true })
    .mockRejectedValueOnce(new Error("private-settings-path"))
    .mockResolvedValueOnce({ ...defaults, enabled: true, minimumRemainingPercent: 30 });
  await render();
  await typeNumber("默认剩余额度阈值", "30");
  await click(footerButton("保存"));
  expect(onClose).not.toHaveBeenCalled();
  expect(document.querySelector("[role=alert]")?.textContent).toBe("设置未保存，请重试。");
  expect(document.body.textContent).not.toContain("private-settings-path");
  expect(Number(input("默认剩余额度阈值").value)).toBe(30);
  await click(footerButton("保存"));
  expect(onClose).toHaveBeenCalledOnce();
});

it("saves concurrent distribution and a fallback Provider independently", async () => {
  vi.mocked(invoke).mockResolvedValue({ ...defaults, enabled: true });
  await render();
  await chooseOption("分配方式", "并发分配");
  await chooseOption("备用 Provider", "备用服务");
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_auto_switch_settings", { settings: {
    ...defaults, enabled: true, mode: "concurrent", fallbackProviderId: "backup",
  } });
  expect(onClose).toHaveBeenCalledOnce();
});

it("drops rules for removed accounts on save while preserving current rules and the fallback choice", async () => {
  const existingRule = { accountId: account.id, enabled: false, priority: 7, thresholdPercent: 15 };
  const settings = { ...defaults, fallbackProviderId: "removed-provider", accounts: [existingRule,
    { accountId: "removed-account", enabled: true, priority: 2, thresholdPercent: 40 },
  ] };
  vi.mocked(invoke).mockResolvedValue(settings);
  await render();
  expect(document.body.textContent).toContain("原备用 Provider 已不可用");
  expect(document.body.textContent).not.toContain("removed-provider");
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_auto_switch_settings", {
    settings: { ...settings, accounts: [existingRule] },
  });
});

it("offers a retry after loading fails and prevents overwriting unread settings", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("private-load-error")).mockResolvedValueOnce(defaults);
  await render();
  expect(footerButton("保存").disabled).toBe(true);
  expect(document.body.textContent).not.toContain("private-load-error");
  const retry = document.querySelector<HTMLButtonElement>("[role=alert] button")!;
  await click(retry);
  expect(footerButton("保存").disabled).toBe(false);
  expect(button("自动切换账号").getAttribute("aria-checked")).toBe("false");
});

it("keeps saving single-flight and blocks dismissal until it finishes", async () => {
  let finish!: (value: GuiAutoSwitchSettings) => void;
  vi.mocked(invoke).mockResolvedValueOnce(defaults).mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve;
  }));
  await render();
  await click(footerButton("保存"));
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(footerButton("取消").disabled).toBe(true);
  expect(button("自动切换账号").disabled).toBe(true);
  await act(async () => finish(defaults));
  expect(onClose).toHaveBeenCalledOnce();
});

it("ignores a late load after closing and masks accounts in privacy mode", async () => {
  let finish!: (value: GuiAutoSwitchSettings) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(defaults);
  await render();
  await act(async () => root.render(null));
  await render(true);
  await act(async () => finish({ ...defaults, enabled: true }));
  expect(button("自动切换账号").getAttribute("aria-checked")).toBe("false");
  expect(document.body.textContent).not.toContain(account.email);
  expect(document.body.textContent).toContain("gui@e*****e.com");
});
