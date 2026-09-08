// @vitest-environment jsdom
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { GuiController } from "./controller";
import { Messages } from "./Messages";
import type { GuiEvent, Item, Thread } from "./types";

vi.mock("./api", () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn(),
} }));
const items: Item[] = [
  { id: "question", type: "userMessage", content: [{ type: "text", text: "检查这个项目" },
    { type: "localImage", path: "D:/screenshot.png" }] },
  { id: "reason", type: "reasoning", summary: ["先检查项目的测试结果"] },
  { id: "command", type: "commandExecution", command: "npm test", aggregatedOutput: "PASS: project tests",
    status: "completed", exitCode: 0 },
  { id: "answer", type: "agentMessage", text: "项目检查通过" },
];
const thread: Thread = { id: "one", cwd: "D:/project", preview: "检查这个项目", updatedAt: 1,
  turns: [{ id: "turn", status: "completed", items }] };
let root: Root;
let container: HTMLDivElement;
let controller: GuiController;
let receive: (event: GuiEvent) => void;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <Messages selected={state.selected} value={state.conversations[state.selected ?? ""]} />;
}

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => {
    receive = callback;
    return vi.fn<() => void>();
  });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list" || request.operation === "models") return { data: [], nextCursor: null };
    return { thread: { ...thread, turns: [] } };
  });
  controller = new GuiController();
  await controller.connect();
  await controller.select(thread.id);
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  controller.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

function expectHistory() {
  expect(container.textContent).toContain("检查这个项目");
  expect(container.textContent).toContain("screenshot.png");
  expect(container.textContent).toContain("先检查项目的测试结果");
  expect(container.textContent).toContain("PASS: project tests");
  expect(container.textContent).toContain("项目检查通过");
  expect(container.querySelectorAll("article")).toHaveLength(2);
}

it("keeps visible messages and expanded activity after completion, reopening, and continuing", async () => {
  await act(async () => {
    receive({ method: "turn/started", params: { threadId: thread.id,
      turn: { id: "turn", status: "inProgress", items: [] } } });
    for (const item of items) receive({ method: "item/completed", params: {
      threadId: thread.id, turnId: "turn", item } });
  });
  const activity = container.querySelectorAll("details")[1];
  activity.open = true;
  await act(async () => receive({ method: "turn/completed", params: { threadId: thread.id,
    turn: { id: "turn", status: "completed", items: [items[3]] } } }));
  expectHistory();
  expect(container.querySelectorAll("details")[1]).toBe(activity);
  expect(activity.open).toBe(true);
  expect(container.textContent).not.toContain("Codex 正在处理");

  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list") return { data: [thread], nextCursor: null };
    if (request.operation === "send") return { turn: { id: "next", status: "inProgress", items: [] } };
    return { thread };
  });
  await act(async () => controller.newConversation());
  await act(async () => controller.select(thread.id));
  expectHistory();
  await act(async () => { expect(await controller.send("继续检查", [])).toBe(true); });
  expectHistory();
  expect(container.textContent).toContain("Codex 正在处理");
});
