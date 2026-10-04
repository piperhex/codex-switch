// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStreamingText } from "./useStreamingText";

let root: Root;
let container: HTMLDivElement;
let now: number;
let nextFrame: number;
let frames: Map<number, FrameRequestCallback>;

function Fixture({ text, streaming }: { text: string; streaming: boolean }) {
  return <span>{useStreamingText(text, streaming)}</span>;
}

async function render(text: string, streaming = true) {
  await act(async () => root.render(<Fixture text={text} streaming={streaming} />));
}

async function advance(milliseconds = 16) {
  now += milliseconds;
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(now)));
}

beforeEach(() => {
  now = 0;
  nextFrame = 0;
  frames = new Map();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(frames.size).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("throttles long replies while continuous deltas still become visible on schedule", async () => {
  vi.useFakeTimers();
  await render("");
  let text = "long streamed reply ".repeat(500);
  for (let index = 0; index < 20; index++) {
    text += String(index);
    await render(text);
    expect(frames.size).toBe(0);
    now += 50;
    await act(async () => { vi.advanceTimersByTime(50); });
    if ((index + 1) % 5 === 0) expect(container.textContent).toBe(text);
  }
  expect(container.textContent).toBe(text);
  expect(vi.getTimerCount()).toBe(0);
});

it("limits very long replies to one update a second and flushes completion immediately", async () => {
  vi.useFakeTimers();
  await render("");
  const text = "long streamed reply ".repeat(5_000);
  await render(text);
  now += 999;
  await act(async () => { vi.advanceTimersByTime(999); });
  expect(container.textContent).toBe("");
  now++;
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(container.textContent).toBe(text);
  await render(text + "final delta");
  expect(container.textContent).toBe(text);
  await render(text + "final delta", false);
  expect(container.textContent).toBe(text + "final delta");
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels a pending long reply timer when hidden or replaced", async () => {
  vi.useFakeTimers();
  await render("");
  await render("long reply ".repeat(1_000));
  expect(vi.getTimerCount()).toBe(1);
  await render("authoritative replacement");
  expect(container.textContent).toBe("authoritative replacement");
  expect(vi.getTimerCount()).toBe(0);
  await render("authoritative replacement" + " continued".repeat(1_000));
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(container.textContent).toContain(" continued");
  expect(vi.getTimerCount()).toBe(0);
});

it("reveals a burst across successive frames and catches up within 120 ms", async () => {
  await render("");
  const text = "这是一次分批到达的流式回复。".repeat(20);
  await render(text);
  expect(container.textContent).toBe("");
  await advance();
  const first = container.textContent!;
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThan(text.length);
  await advance();
  expect(container.textContent!.length).toBeGreaterThan(first.length);
  expect(text.startsWith(container.textContent!)).toBe(true);
  await advance(120);
  expect(container.textContent).toBe(text);
  expect(frames.size).toBe(0);
});

it("keeps receiving bursts in order without restarting the visible prefix or losing text", async () => {
  await render("");
  let text = "";
  for (let index = 0; index < 30; index += 1) {
    const previous = container.textContent!;
    text += `片段${index}，`;
    await render(text);
    await advance(32);
    expect(container.textContent!.startsWith(previous)).toBe(true);
    expect(text.startsWith(container.textContent!)).toBe(true);
    expect(frames.size).toBeLessThanOrEqual(1);
  }
  await advance(120);
  expect(container.textContent).toBe(text);
});

it("shows history immediately and flushes on completion or interruption", async () => {
  await render("已有的历史消息");
  expect(container.textContent).toBe("已有的历史消息");
  await render("已有的历史消息，正在继续回复");
  await advance();
  await render("已有的历史消息，最终回复", false);
  expect(container.textContent).toBe("已有的历史消息，最终回复");
  expect(frames.size).toBe(0);
});

it("replaces corrected text immediately and cancels obsolete animation", async () => {
  await render("原文");
  await render("原文正在追加文字");
  await advance();
  await render("校正后的全文");
  expect(container.textContent).toBe("校正后的全文");
  expect(frames.size).toBe(0);
});

it("never displays half of an emoji", async () => {
  await render("");
  await render("😀😀中文😀");
  for (let index = 0; index < 10; index += 1) {
    await advance();
    expect(container.textContent).not.toMatch(/[\uD800-\uDBFF]$/);
  }
  expect(container.textContent).toBe("😀😀中文😀");
});

it("flushes in a hidden window instead of leaving a paused animation backlog", async () => {
  await render("");
  await render("窗口隐藏前收到的文字");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(container.textContent).toBe("窗口隐藏前收到的文字");
  expect(frames.size).toBe(0);
  await render("窗口隐藏前收到的文字以及后台收到的文字");
  expect(container.textContent).toBe("窗口隐藏前收到的文字以及后台收到的文字");
  expect(frames.size).toBe(0);
});
