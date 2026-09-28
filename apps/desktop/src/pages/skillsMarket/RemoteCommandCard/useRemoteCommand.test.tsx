// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteCommandStatus } from "../../../api/remoteCommand";
import { useRemoteCommand } from "./useRemoteCommand";

const api = vi.hoisted(() => ({ remoteCommandStatus: vi.fn(), remoteCommandAction: vi.fn() }));
vi.mock("../../../api/remoteCommand", () => api);
const installed: RemoteCommandStatus = { installed: true, enabled: true, needsRepair: false, version: "1.0.0" };
let root: Root;
let hook: ReturnType<typeof useRemoteCommand>;
function Harness({ active = true }: { active?: boolean }) {
  hook = useRemoteCommand("gui", active);
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  api.remoteCommandStatus.mockResolvedValue(installed);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it("keeps polling single-flight and stops while inactive", async () => {
  let finish!: (status: RemoteCommandStatus) => void;
  api.remoteCommandStatus.mockReturnValue(new Promise<RemoteCommandStatus>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.remoteCommandStatus).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => finish(installed));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.remoteCommandStatus).toHaveBeenCalledTimes(1);
  expect(hook.status).toBeNull();
});

it("does not overwrite disabled state with an older status response", async () => {
  let finish!: (status: RemoteCommandStatus) => void;
  api.remoteCommandStatus.mockReturnValue(new Promise<RemoteCommandStatus>((resolve) => { finish = resolve; }));
  api.remoteCommandAction.mockResolvedValue({ ...installed, enabled: false });
  await act(async () => root.render(<Harness />));
  await act(async () => hook.run("disable"));
  await act(async () => finish(installed));
  expect(hook.status?.enabled).toBe(false);
  expect(api.remoteCommandAction).toHaveBeenCalledWith("gui", "disable");
});

it("pauses polling during installation and prevents duplicate actions", async () => {
  let finish!: (status: RemoteCommandStatus) => void;
  api.remoteCommandAction.mockReturnValue(new Promise<RemoteCommandStatus>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  let pending!: Promise<void>;
  await act(async () => { pending = hook.run("install"); });
  await act(async () => hook.run("install"));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.remoteCommandAction).toHaveBeenCalledTimes(1);
  expect(api.remoteCommandStatus).toHaveBeenCalledTimes(1);
  expect(hook.busy).toBe(true);
  await act(async () => { finish(installed); await pending; });
  expect(hook.status?.enabled).toBe(true);
  expect(hook.busy).toBe(false);
});

it("finishes initial status under StrictMode and retains action errors until retry", async () => {
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
  expect(hook.status).toEqual(installed);
  expect(vi.getTimerCount()).toBe(1);
  api.remoteCommandAction.mockRejectedValueOnce("安装未完成").mockResolvedValue(installed);
  await act(async () => hook.run("install"));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(hook.error).toBe("安装未完成");
  await act(async () => hook.run("install"));
  expect(hook.error).toBe("");
});
