// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Messages } from "./Messages";
import type { Conversation, Item } from "./types";
import { CONTINUE_MESSAGE } from "./continuation";

const rendered = vi.hoisted(() => ({ texts: new Set<string>() }));
vi.mock("./RichText", () => ({ RichText: ({ text }: { text: string }) => {
  rendered.texts.add(text);
  return <p>{text}</p>;
} }));
let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let serial: number;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const item = (index: number): Item => ({ id: `item-${index}`, type: "agentMessage", phase: "final_answer",
  text: `Message ${index}` });
const conversation = (id = "chat"): Conversation => ({ thread: { id, cwd: "", preview: "", updatedAt: 1 },
  activeTurn: null, tokens: 0, error: "", turns: [{ id: "turn", status: "completed",
    items: Array.from({ length: 35 }, (_, index) => item(index)) }] });

beforeEach(() => {
  frames = new Map(); serial = 0; rendered.texts.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++serial, callback); return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
const render = (value: Conversation, active = true) => act(async () => root.render(
  <Messages selected={value.thread.id} value={value} active={active} />));
const count = () => container.querySelectorAll("[data-message-id]").length;
const button = () => [...container.querySelectorAll("button")].find((entry) => entry.textContent === "加载更早的消息")!;
async function frame() {
  const callbacks = [...frames.values()]; frames.clear();
  await act(async () => callbacks.forEach((callback) => callback(performance.now())));
}
async function older() { await act(async () => button().click()); await frame(); await frame(); }

it("mounts only ten rich messages, shows loading before the next batch, and never overlaps batches", async () => {
  await render(conversation());
  expect(count()).toBe(10);
  expect(rendered.texts.size).toBe(10);
  expect(rendered.texts.has("Message 0")).toBe(false);
  const last = container.querySelector('[data-message-id="item-34"]');
  const load = button();
  await act(async () => { load.click(); load.click(); });
  expect(container.textContent).toContain("正在加载更早的消息");
  await frame();
  expect(count()).toBe(10);
  await frame();
  expect(count()).toBe(20);
  expect(container.querySelector('[data-message-id="item-34"]')).toBe(last);
  await older(); expect(count()).toBe(30);
  await older(); expect(count()).toBe(35);
  expect(button()).toBeUndefined();
});

it("resets cached conversations to ten items on reentry and cancels pending work on navigation", async () => {
  const cached = conversation();
  await render(cached); await older(); expect(count()).toBe(20);
  await render(conversation("other")); await render(cached); expect(count()).toBe(10);
  await act(async () => button().click());
  await render(cached, false); expect(frames.size).toBe(0);
  await render(cached); expect(count()).toBe(10);
  await older(); await render(cached, false); await render(cached); expect(count()).toBe(10);
});

it("keeps streamed items and an expanded partial activity group while older components mount", async () => {
  const value = conversation();
  value.turns[0].items.forEach((entry) => { entry.phase = "commentary"; });
  await render(value);
  const details = container.querySelector("details")!;
  details.open = true;
  await act(async () => button().click());
  const next = { ...value, turns: [{ ...value.turns[0], items: [...value.turns[0].items, item(35)] }] };
  await render(next);
  expect(count()).toBe(11);
  await frame(); await frame();
  expect(count()).toBe(21);
  expect(container.querySelector("details")).toBe(details);
  expect(details.open).toBe(true);
  expect(container.textContent).toContain("Message 35");
});

it("uses the full turn to distinguish a hidden continuation instruction from later user messages", async () => {
  const value = conversation();
  const instruction: Item = { id: "continue", type: "userMessage",
    content: [{ type: "text", text: CONTINUE_MESSAGE }] };
  value.turns.unshift({ id: "stopped", status: "interrupted", items: [] });
  value.turns[1].items[0] = instruction;
  value.turns[1].items[25] = { ...instruction, id: "steering" };
  await render(value);
  expect(container.textContent).toContain(CONTINUE_MESSAGE);
  expect(container.querySelector('[data-message-id="steering"]')).not.toBeNull();
});

it("does not mount old generated image previews until their history batch is loaded", async () => {
  const value = conversation();
  value.turns[0].items[0] = { id: "generated", type: "imageGeneration", status: "completed", result: "iVBORw0KGgo=" };
  await render(value);
  expect(container.querySelector('[aria-label="生成的图片"]')).toBeNull();
  await older(); await older();
  expect(container.querySelector('[aria-label="生成的图片"]')).toBeNull();
  await older();
  expect(container.querySelector('[aria-label="生成的图片"] img')).not.toBeNull();
});
