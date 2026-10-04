// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoRefresh } from "./useAutoRefresh";

let root: Root;
let settings: ReturnType<typeof useAutoRefresh>;
const onRefresh = vi.fn<() => Promise<void>>();

function Fixture({ active = true }: { active?: boolean }) {
  settings = useAutoRefresh(active, onRefresh);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem("codex-switch:auto-refresh-seconds", "1");
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("skips overlapping global refreshes even when the interval changes", async () => {
  let release = () => {};
  onRefresh.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
  onRefresh.mockResolvedValue(undefined);
  await act(async () => root.render(<Fixture />));
  await act(async () => { vi.advanceTimersByTime(1_000); });
  expect(onRefresh).toHaveBeenCalledTimes(1);
  await act(async () => settings.updateSeconds(2));
  await act(async () => { vi.advanceTimersByTime(10_000); });
  expect(onRefresh).toHaveBeenCalledTimes(1);
  await act(async () => release());
  await act(async () => { vi.advanceTimersByTime(2_000); });
  expect(onRefresh).toHaveBeenCalledTimes(2);
});

it("stops polling while inactive or disabled and removes the timer on unmount", async () => {
  onRefresh.mockResolvedValue(undefined);
  await act(async () => root.render(<Fixture />));
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => { vi.advanceTimersByTime(5_000); });
  expect(onRefresh).not.toHaveBeenCalled();
  await act(async () => root.render(<Fixture />));
  await act(async () => settings.setEnabled(false));
  await act(async () => { vi.advanceTimersByTime(5_000); });
  expect(onRefresh).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => settings.setEnabled(true));
  await act(async () => { vi.advanceTimersByTime(1_000); });
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
