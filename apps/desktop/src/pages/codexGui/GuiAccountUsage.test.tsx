// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiAccountUsage } from "./GuiAccountUsage";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows remaining quota and updates the reset countdown without requesting data", async () => {
  const resetsAt = Date.now() / 1_000 + 86_401;
  await act(async () => root.render(<GuiAccountUsage label="主用量"
    usage={{ usedPercent: 25, remainingPercent: 75, resetsAt }} />));
  const progress = container.querySelector('[role="progressbar"]')!;
  expect(progress.getAttribute("aria-valuenow")).toBe("75");
  expect(progress.getAttribute("aria-label")).toBe("主用量剩余");
  expect(container.textContent).toContain("1天 00:00:01 后重置");
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(container.textContent).toContain("23:59:59 后重置");
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("distinguishes missing quota, unknown reset times, and expired reset times", async () => {
  await act(async () => root.render(<GuiAccountUsage label="次用量" />));
  expect(container.textContent).toBe("暂无用量");
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  await act(async () => root.render(<GuiAccountUsage label="次用量"
    usage={{ usedPercent: 100, remainingPercent: 0 }} />));
  expect(container.textContent).toContain("重置时间未知");
  const resetsAt = Date.now() / 1_000 - 1;
  await act(async () => root.render(<GuiAccountUsage label="次用量"
    usage={{ usedPercent: 100, remainingPercent: 0, resetsAt }} />));
  expect(container.textContent).toContain("已到重置时间，等待刷新");
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");
});
