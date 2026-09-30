// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { GuiController } from "./controller";
import { ComposerBridge } from "./composerBridge";
import { GuiModelCatalog } from "./modelCatalog";
import { MODEL_CATALOG_REFRESH_MS, watchModelCatalog } from "./modelCatalogRefresh";
import { subscribeGuiEvent } from "./webEvents";
import type { Model } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./webEvents", () => ({ subscribeGuiEvent: vi.fn() }));
const model = (name: string): Model => ({ id: name, model: name, displayName: name, isDefault: true,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
});
const existing = model("gpt-6-sol");
const released = model("gpt-6.1-sol");

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(vi.fn());
  vi.mocked(subscribeGuiEvent).mockResolvedValue(vi.fn());
});
afterEach(() => vi.useRealTimers());

it("publishes new upstream models to desktop and remote clients during an active turn", async () => {
  const controller = new GuiController();
  const bridge = new ComposerBridge();
  const detach = bridge.attach(controller);
  vi.mocked(guiApi.request).mockImplementation(async (request) => ({
    data: request.operation === "models" ? [existing] : [], nextCursor: null,
  }));
  await controller.connect();
  controller.settings({ model: existing.model, effort: "high" });
  const receive = vi.mocked(guiApi.subscribe).mock.calls[0][0];
  receive({ method: "thread/started", params: { thread: { id: "live", cwd: "", preview: "", updatedAt: 1 } } });
  receive({ method: "turn/started", params: { threadId: "live",
    turn: { id: "turn", status: "inProgress", items: [] } } });
  const live = controller.getSnapshot().conversations.live;
  const published = vi.fn();
  const stop = bridge.subscribe(published);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [released, existing], nextCursor: null });
  await controller.modelCatalog.refresh();
  expect(controller.getSnapshot().models).toEqual([released, existing]);
  expect(controller.getSnapshot().settings).toMatchObject({ model: existing.model, effort: "high" });
  expect(controller.getSnapshot().conversations.live).toBe(live);
  expect(guiApi.connect).toHaveBeenCalledOnce();
  expect((await bridge.read()).models).toEqual([released, existing]);
  expect(published).toHaveBeenCalledWith(expect.objectContaining({ models: [released, existing] }));
  expect((await bridge.update({ model: released.model })).settings)
    .toMatchObject({ model: released.model, effort: "medium" });
  stop(); detach(); controller.dispose();
});

it("coalesces menu and timer refreshes, paginates, and drops an old account response", async () => {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ data: [released], nextCursor: "page-2" })
    .mockResolvedValueOnce({ data: [existing], nextCursor: null });
  const pending = catalog.refresh();
  expect(catalog.refresh()).toBe(pending);
  expect(catalog.invalidate()).toBe(pending);
  finish({ data: [model("old-account")], nextCursor: "stale-page" });
  await pending;
  expect(guiApi.request).toHaveBeenCalledTimes(3);
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: "models", cursor: "page-2" });
  expect(accept).toHaveBeenCalledExactlyOnceWith([released, existing]);
});

it("keeps the last successful catalog after failure and ignores results after suspension", async () => {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [existing], nextCursor: null });
  await catalog.refresh();
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("offline"));
  await expect(catalog.refresh()).rejects.toThrow("offline");
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = catalog.refresh();
  catalog.suspend();
  finish({ data: [released], nextCursor: null });
  await pending;
  await catalog.refresh();
  expect(accept).toHaveBeenCalledExactlyOnceWith([existing]);
});

it("stops polling and unsubscribes even when the subscription finishes after cleanup", async () => {
  vi.useFakeTimers();
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn() });
  let subscribe!: (stop: () => void) => void;
  vi.mocked(subscribeGuiEvent).mockImplementation(() => new Promise((resolve) => { subscribe = resolve; }));
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const stop = watchModelCatalog(catalog, vi.fn());
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS * 3);
  expect(guiApi.request).toHaveBeenCalledOnce();
  stop(); catalog.suspend();
  const unsubscribe = vi.fn();
  subscribe(unsubscribe);
  finish({ data: [existing], nextCursor: null });
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS * 3);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(guiApi.request).toHaveBeenCalledOnce();
});
