// @vitest-environment jsdom
import { act } from "react";
import { App, ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { guiApi } from "./api";
import { ThreadSidebar } from "./ThreadSidebar";
import { initialState } from "./preferences";
import type { GuiState } from "./types";

let root: Root;
let container: HTMLDivElement;
let controller: GuiController;
let state: GuiState;
const render = () => act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
  <App><ThreadSidebar state={state} controller={controller} accountPicker={null}
    focused={false} onToggleFocus={vi.fn()} /></App>
</ConfigProvider>));
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((entry) => entry.textContent === text)!;
const openThreadMenu = () => act(async () => {
  button("会话示例").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  controller = new GuiController();
  state = { ...initialState(), connection: "ready",
    threads: [{ id: "one", cwd: "D:/project", preview: "会话示例", updatedAt: 1, turns: [] }] };
  vi.spyOn(controller, "deleteThread").mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("offers a compact confirmation and sends the selected conversation to trash", async () => {
  await render();
  await openThreadMenu();
  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((entry) => entry.textContent === "删除")!;
  expect(remove).toBeTruthy();
  await act(async () => remove.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.style.width).toBe("400px");
  expect(dialog.textContent).toContain("会话管理");
  expect(dialog.textContent).toContain("指定的 Codex Home");
  await act(async () => button("移入回收站").click());
  expect(controller.deleteThread).toHaveBeenCalledWith("one");
});

it("disables deletion while Codex reports an active reply", async () => {
  state.threads[0].status = { type: "active" };
  await render();
  await openThreadMenu();
  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((entry) => entry.textContent === "删除")!;
  expect(remove.getAttribute("aria-disabled")).toBe("true");
  expect(controller.deleteThread).not.toHaveBeenCalled();
});

it("selects on left click and opens management actions only on right click", async () => {
  const select = vi.spyOn(controller, "select").mockResolvedValue();
  const pin = vi.spyOn(controller, "pin");
  await render();
  expect(container.querySelector('[aria-label="管理对话：会话示例"]')).toBeNull();
  await act(async () => button("会话示例").click());
  expect(select).toHaveBeenCalledExactlyOnceWith("one");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  select.mockClear();
  await openThreadMenu();
  expect(select).not.toHaveBeenCalled();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((entry) => entry.textContent === "置顶")!;
  await act(async () => item.click());
  expect(pin).toHaveBeenCalledWith("one");
});

it("starts a new chat in the clicked project without moving the current conversation or toggling its folder", async () => {
  const previous = { ...state.threads[0], id: "previous", cwd: "D:/other" };
  vi.spyOn(guiApi, "request").mockImplementation(async (request) => {
    if (request.operation === "read") return { thread: previous };
    return { goals: [] };
  });
  await controller.select(previous.id);
  controller.settings({ cwd: previous.cwd });
  state = { ...state, selected: previous.id, archived: true };
  await render();
  const heading = button("project");
  await act(async () => heading.click());
  const add = container.querySelector<HTMLButtonElement>('[aria-label="在 project 中新建对话"]')!;
  await act(async () => add.click());
  expect(heading.getAttribute("aria-expanded")).toBe("false");
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().archived).toBe(false);
  expect(controller.getSnapshot().settings.cwd).toBe("D:/project");
  expect(controller.getSnapshot().projectOverrides).toEqual({});
  expect(controller.getSnapshot().conversations.previous.thread.cwd).toBe("D:/other");
  expect(new GuiController().getSnapshot().settings.cwd).toBe("D:/project");
});

it("offers pin and remove actions on projects while keeping the recent group unmanaged", async () => {
  state.threads.push({ ...state.threads[0], id: "recent", cwd: "" });
  const pin = vi.spyOn(controller.projectActions, "pin");
  const remove = vi.spyOn(controller.projectActions, "remove").mockResolvedValue(true);
  await render();
  expect(container.querySelector('section[aria-label="最近"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="管理项目：最近"]')).toBeNull();
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="管理项目：project"]')!;
  const choose = async (label: string) => {
    await act(async () => trigger.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === label)!;
    await act(async () => item.click());
  };
  await choose("置顶");
  expect(pin).toHaveBeenCalledWith("D:/project");
  state = { ...state, pinnedProjects: ["D:/project"] };
  await render();
  await choose("取消置顶");
  expect(controller.getSnapshot().pinnedProjects).toEqual([]);
  await choose("移除项目");
  expect(remove).toHaveBeenCalledWith("D:/project");
  expect(button("project").getAttribute("aria-expanded")).toBe("true");
});

it("shows a spinner for active chats, a dot for completed unread chats, and no dot for read chats", async () => {
  state.threadReadState.one = { turnId: "turn", unread: true };
  state.threads[0].status = { type: "active" };
  await render();
  expect(container.querySelector('[aria-label="正在回复"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="未读回复"]')).toBeNull();
  state = { ...state, threads: [{ ...state.threads[0], status: { type: "idle" } }] };
  await render();
  expect(container.querySelector('[aria-label="正在回复"]')).toBeNull();
  expect(container.querySelector('[aria-label="未读回复"]')).toBeTruthy();
  state = { ...state, threadReadState: { one: { turnId: "turn", unread: false } } };
  await render();
  expect(container.querySelector('[aria-label="未读回复"]')).toBeNull();
});
