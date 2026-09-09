// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkingStatus } from "./WorkingStatus";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("updates elapsed seconds locally, pauses when hidden, and catches up on return", async () => {
  const render = (active: boolean) => act(async () => root.render(
    <WorkingStatus phase="command" startedAtMs={100_000} active={active} />));
  await render(true);
  expect(host.textContent).toBe("正在执行命令 · 0秒");
  await act(async () => { vi.advanceTimersByTime(12_000); });
  expect(host.textContent).toBe("正在执行命令 · 12秒");
  expect(vi.getTimerCount()).toBe(1);
  await render(false);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(50_000);
  await render(true);
  expect(host.textContent).toBe("正在执行命令 · 1分2秒");
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("resets the displayed phase time and never renders a negative duration", async () => {
  await act(async () => root.render(<WorkingStatus phase="request" startedAtMs={90_000} active />));
  expect(host.textContent).toBe("等待响应 · 10秒");
  vi.setSystemTime(120_000);
  await act(async () => root.render(<WorkingStatus phase="response" startedAtMs={120_000} active />));
  expect(host.textContent).toBe("正在生成回复 · 0秒");
  await act(async () => root.render(<WorkingStatus phase="response" startedAtMs={125_000} active />));
  expect(host.textContent).toBe("正在生成回复 · 0秒");
});
