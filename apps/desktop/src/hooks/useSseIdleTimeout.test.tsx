// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSseIdleTimeout, saveSseIdleTimeout, type SseIdleTimeoutSettings } from "../api/sseIdleTimeout";
import { useSseIdleTimeout } from "./useSseIdleTimeout";

vi.mock("../api/sseIdleTimeout", () => ({
  DEFAULT_SSE_IDLE_TIMEOUT: { enabled: true, timeoutSeconds: 120 },
  MAX_SSE_IDLE_TIMEOUT_SECONDS: 3600,
  loadSseIdleTimeout: vi.fn(),
  saveSseIdleTimeout: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
let controls: ReturnType<typeof useSseIdleTimeout>;
const notify = vi.fn();

function Fixture() {
  controls = useSseIdleTimeout(notify);
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTicks((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  return <span>{ticks}</span>;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.mocked(loadSseIdleTimeout).mockResolvedValue({ enabled: true, timeoutSeconds: 600 });
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("keeps polling responsive and prevents overlapping saves", async () => {
  let complete!: (settings: SseIdleTimeoutSettings) => void;
  vi.mocked(saveSseIdleTimeout).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  await act(async () => {
    controls.updateEnabled(false);
    controls.updateSeconds(900);
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(saveSseIdleTimeout).toHaveBeenCalledTimes(1);
  expect(saveSseIdleTimeout).toHaveBeenCalledWith({ enabled: false, timeoutSeconds: 600 });
  expect(host.textContent).toBe("5");
  expect(controls.loading).toBe(true);
  await act(async () => complete({ enabled: false, timeoutSeconds: 600 }));
  expect(controls.settings).toEqual({ enabled: false, timeoutSeconds: 600 });
  expect(controls.loading).toBe(false);
});

it("preserves saved settings when a change fails and allows retry", async () => {
  vi.mocked(saveSseIdleTimeout).mockRejectedValueOnce(new Error("Save failed"));
  await act(async () => controls.updateEnabled(false));
  expect(controls.settings).toEqual({ enabled: true, timeoutSeconds: 600 });
  expect(notify).toHaveBeenCalledWith("Error: Save failed");
  vi.mocked(saveSseIdleTimeout).mockResolvedValueOnce({ enabled: true, timeoutSeconds: 900 });
  await act(async () => controls.updateSeconds(900));
  expect(controls.settings.timeoutSeconds).toBe(900);
});
