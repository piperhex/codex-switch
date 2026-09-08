// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useUsageStatus } from "./useUsageStatus";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const usage = { totalTokens: 50290000, estimatedCostUsd: 74.32, primaryRemainingPercent: 95,
  primaryRemainingAggregated: false, providerEstimatedCost: null };
const proxy = { running: true, fastModeEnabled: false, fastModeAvailable: true };
let root: Root;
let result: ReturnType<typeof useUsageStatus>;
function Probe({ active = true }: { active?: boolean }) { result = useUsageStatus(active); return null; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GUI usage refresh", () => {
  it("waits for both requests after one fails and stops refreshing when hidden", async () => {
    const pendingUsage = deferred<typeof usage>();
    const pendingProxy = deferred<typeof proxy>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "codex_gui_usage_summary" ? pendingUsage.promise : pendingProxy.promise);
    await act(async () => root.render(<Probe />));
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => { pendingUsage.reject(new Error("temporarily unavailable")); });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => { pendingProxy.resolve(proxy); });
    expect(result.error).not.toBe("");
    await act(async () => root.render(<Probe active={false} />));
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a speed change with an older refresh result", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => command === "codex_gui_usage_summary" ? usage : proxy);
    await act(async () => root.render(<Probe />));
    const pendingProxy = deferred<typeof proxy>();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_local_proxy_status") return pendingProxy.promise;
      if (command === "set_local_proxy_fast_mode") return { ...proxy, fastModeEnabled: true };
      return usage;
    });
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    await act(async () => result.setFastMode(true));
    expect(result.proxy?.fastModeEnabled).toBe(true);
    await act(async () => { pendingProxy.resolve(proxy); });
    expect(result.proxy?.fastModeEnabled).toBe(true);
  });
});
