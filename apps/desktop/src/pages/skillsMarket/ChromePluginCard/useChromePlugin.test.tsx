// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChromePluginStatus } from "../../../api/chromePlugin";
import { useChromePlugin } from "./useChromePlugin";

const api = vi.hoisted(() => ({ chromePluginStatus: vi.fn(), chromePluginAction: vi.fn() }));
vi.mock("../../../api/chromePlugin", () => api);

const installed: ChromePluginStatus = { installed: true, enabled: true, needsRepair: false,
  connectedBrowsers: 0, activeBrowsers: 0, version: "1.0.0", supported: true, extensionDirectory: "test" };
let root: Root;
let hook: ReturnType<typeof useChromePlugin>;
function Harness({ home = "first", active = true }: { home?: string; active?: boolean }) {
  hook = useChromePlugin(home, active);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  api.chromePluginStatus.mockResolvedValue(installed);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it("never overlaps status polling and stops when the card is inactive", async () => {
  let finish!: (status: ChromePluginStatus) => void;
  api.chromePluginStatus.mockReturnValue(new Promise<ChromePluginStatus>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.chromePluginStatus).toHaveBeenCalledTimes(1);
  await act(async () => finish(installed));
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.chromePluginStatus).toHaveBeenCalledTimes(1);
});

it("does not let a late status response overwrite a completed installation action", async () => {
  let finish!: (status: ChromePluginStatus) => void;
  api.chromePluginStatus.mockReturnValue(new Promise<ChromePluginStatus>((resolve) => { finish = resolve; }));
  api.chromePluginAction.mockResolvedValue(installed);
  await act(async () => root.render(<Harness />));
  await act(async () => { await hook.run("install"); });
  await act(async () => finish({ ...installed, installed: false, enabled: false }));
  expect(hook.status?.installed).toBe(true);
  expect(api.chromePluginAction).toHaveBeenCalledWith("first", "install");
});

it("preserves action errors through polling and clears them on a successful retry", async () => {
  api.chromePluginAction.mockRejectedValueOnce("安装未完成").mockResolvedValue(installed);
  await act(async () => root.render(<Harness />));
  await act(async () => { await hook.run("install"); });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(hook.error).toBe("安装未完成");
  await act(async () => { await hook.run("install"); });
  expect(hook.error).toBe("");
});

it("isolates pending status responses when the selected home remounts the card", async () => {
  let finish!: (status: ChromePluginStatus) => void;
  api.chromePluginStatus.mockImplementation((home: string) => home === "first"
    ? new Promise<ChromePluginStatus>((resolve) => { finish = resolve; })
    : Promise.resolve({ ...installed, enabled: false }));
  await act(async () => root.render(<Harness key="first" />));
  await act(async () => root.render(<Harness key="second" home="second" />));
  await act(async () => finish(installed));
  expect(hook.status?.enabled).toBe(false);
});
