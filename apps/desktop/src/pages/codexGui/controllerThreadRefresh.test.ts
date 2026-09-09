// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { GuiController } from "./controller";
import type { GuiEvent, Thread } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const thread: Thread = { id: "one", cwd: "D:/project", preview: "", updatedAt: 1, turns: [] };
let receive: (event: GuiEvent) => void;
let controller: GuiController;

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => {
    receive = callback;
    return vi.fn<() => void>();
  });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list") return { data: [thread], nextCursor: null };
    if (request.operation === "models") return { data: [], nextCursor: null };
    return { thread };
  });
  controller = new GuiController();
  await controller.connect();
  await controller.select(thread.id);
});

afterEach(() => controller.dispose());

function receiveFirstMessage() {
  receive({ method: "turn/started", params: { threadId: thread.id,
    turn: { id: "turn", status: "inProgress", items: [] } } });
  receive({ method: "item/completed", params: { threadId: thread.id, turnId: "turn",
    item: { id: "question", type: "userMessage", content: [{ type: "text", text: "检查项目" }] } } });
}

it("updates the sidebar as soon as the conversation heading gets its first preview", () => {
  controller.setProject("D:/other");
  receiveFirstMessage();
  const state = controller.getSnapshot();
  expect(state.conversations.one.thread.preview).toBe("检查项目");
  expect(state.threads[0]).toMatchObject({ id: thread.id, preview: "检查项目", cwd: "D:/other" });
});

it("keeps the live preview when an earlier list request returns an empty summary", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const refreshing = controller.refresh();
  receiveFirstMessage();
  resolve({ data: [thread], nextCursor: null });
  await refreshing;
  expect(controller.getSnapshot().threads[0].preview).toBe("检查项目");
});

it("shows a new live thread before the list endpoint has indexed it", async () => {
  vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [], nextCursor: null });
  await controller.refresh();
  receiveFirstMessage();
  expect(controller.getSnapshot().threads).toEqual([expect.objectContaining({
    id: thread.id, preview: "检查项目",
  })]);
});

it.each([{ archived: true, search: "" }, { archived: false, search: "unrelated" }])(
  "does not insert a live thread into a filtered list: %j", async ({ archived, search }) => {
    vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [], nextCursor: null });
    controller.filter(search, archived);
    await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
    receiveFirstMessage();
    expect(controller.getSnapshot().threads).toEqual([]);
  },
);
