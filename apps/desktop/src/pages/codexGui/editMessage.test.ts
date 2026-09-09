// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { GuiController } from "./controller";
import type { GuiEvent, Thread, Turn } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn() } }));
const source: Thread = { id: "source", cwd: "D:/project", preview: "original", updatedAt: 1, turns: [
  { id: "old", status: "completed", items: [{ id: "old-user", type: "userMessage",
    content: [{ type: "text", text: "early context" }] }] },
  { id: "last", status: "completed", items: [{ id: "user", type: "userMessage",
    content: [{ type: "text", text: "original" }] }, { id: "answer", type: "agentMessage", text: "old answer" }] },
] };
const branch: Thread = { ...source, id: "branch", turns: [source.turns![0]] };
const turn: Turn = { id: "new", status: "inProgress", items: [{ id: "edited", type: "userMessage",
  content: [{ type: "text", text: "edited" }] }] };
const edit = { threadId: "source", turnId: "last", itemId: "user", text: "edited" };
let receive: (event: GuiEvent) => void;

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return vi.fn<() => void>(); });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list" || request.operation === "models") return { data: [], nextCursor: null };
    if (request.operation === "editMessage") return { thread: branch, turn };
    return { thread: source };
  });
});
async function setup() {
  const controller = new GuiController();
  await controller.connect(); await controller.select(source.id);
  return controller;
}

it("branches at the original position, sends current settings, and preserves the original history", async () => {
  const controller = await setup();
  controller.settings({ model: "model", effort: "high", access: "workspace-write" });
  controller.setProject("D:/override");
  const original = controller.getSnapshot().conversations.source;
  expect(await controller.messageEditor.submit(edit)).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "editMessage", ...edit,
    model: "model", effort: "high", access: "workspace-write", cwd: "D:/override" });
  const state = controller.getSnapshot();
  expect(state.selected).toBe("branch");
  expect(state.conversations.source).toBe(original);
  expect(state.conversations.branch.turns.map((entry) => entry.id)).toEqual(["old", "new"]);
  expect(state.conversations.branch.activeTurn).toBe("new");
  expect(state.sending).toBe(false);
  controller.dispose();
});

it("preserves completed streaming events that arrive before the acknowledgement", async () => {
  const controller = await setup();
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation !== "editMessage") return original(request);
    receive({ method: "thread/started", params: { thread: branch } });
    receive({ method: "turn/started", params: { threadId: branch.id, turn } });
    receive({ method: "turn/completed", params: { threadId: branch.id, turn: { ...turn,
      status: "completed", items: [...turn.items, { id: "reply", type: "agentMessage", text: "new reply" }] } } });
    return { thread: branch, turn };
  });
  expect(await controller.messageEditor.submit(edit)).toBe(true);
  expect(controller.getSnapshot().conversations.branch.activeTurn).toBeNull();
  expect(controller.getSnapshot().conversations.branch.turns.at(-1)?.items.at(-1)?.text).toBe("new reply");
  controller.dispose();
});

it("keeps selection and source history on failure", async () => {
  const controller = await setup();
  const before = controller.getSnapshot().conversations;
  vi.mocked(guiApi.request).mockRejectedValue(new Error("暂时无法发送"));
  expect(await controller.messageEditor.submit(edit)).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ selected: "source", sending: false, error: "暂时无法发送" });
  expect(controller.getSnapshot().conversations).toBe(before);
  controller.dispose();
});

it("rejects stale messages, empty edits, active turns, and duplicate submissions", async () => {
  const controller = await setup();
  vi.mocked(guiApi.request).mockClear();
  expect(await controller.messageEditor.submit({ ...edit, itemId: "old-user" })).toBe(false);
  expect(await controller.messageEditor.submit({ ...edit, text: "  " })).toBe(false);
  receive({ method: "turn/started", params: { threadId: source.id, turn } });
  expect(await controller.messageEditor.submit(edit)).toBe(false);
  expect(guiApi.request).not.toHaveBeenCalled();
  controller.dispose();
  const fresh = await setup();
  let finish!: (value: unknown) => void;
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "editMessage"
    ? new Promise((resolve) => { finish = resolve; }) : original(request));
  const sending = fresh.messageEditor.submit(edit);
  expect(await fresh.messageEditor.submit(edit)).toBe(false);
  fresh.newConversation();
  finish({ thread: branch, turn });
  expect(await sending).toBe(true);
  expect(fresh.getSnapshot().selected).toBeNull();
  fresh.dispose();
});
