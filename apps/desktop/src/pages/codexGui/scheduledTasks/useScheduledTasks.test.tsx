// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scheduledTasksApi } from "./api";
import { useScheduledTasks } from "./useScheduledTasks";
import type { ScheduledTask } from "./types";

vi.mock("./api", () => ({ scheduledTasksApi: { request: vi.fn() } }));
let root: Root;
let state: ReturnType<typeof useScheduledTasks>;
let active = true;

function Fixture() { state = useScheduledTasks(active); return null; }
const render = () => act(async () => root.render(<Fixture />));
const task: ScheduledTask = {
  id: "task-1", title: "检查发布", prompt: "检查更新", cwd: "", schedule: { kind: "interval", minutes: 5 },
  status: "active", nextRunAt: 100, lastRunAt: null, lastThreadId: null, lastTurnId: null,
  runStatus: "idle", error: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  active = true;
  root = createRoot(document.createElement("div"));
  vi.mocked(scheduledTasksApi.request).mockReset().mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps polling single-flight and clears polling while inactive", async () => {
  let finish!: (tasks: ScheduledTask[]) => void;
  vi.mocked(scheduledTasksApi.request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(scheduledTasksApi.request).toHaveBeenCalledTimes(1);
  await act(async () => finish([task]));
  expect(state.tasks).toEqual([task]);
  active = false;
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(scheduledTasksApi.request).toHaveBeenCalledTimes(1);
});

it("does not let a slow read overwrite a saved task and prevents duplicate mutations", async () => {
  let finishRead!: (tasks: ScheduledTask[]) => void;
  let finishSave!: (tasks: ScheduledTask[]) => void;
  vi.mocked(scheduledTasksApi.request).mockImplementation((request) => new Promise((resolve) => {
    if (request.operation === "list") finishRead = resolve;
    else finishSave = resolve;
  }));
  await render();
  let mutation!: Promise<boolean>;
  await act(async () => { mutation = state.mutate({ operation: "runNow", id: task.id }); });
  expect(await state.mutate({ operation: "runNow", id: task.id })).toBe(false);
  await act(async () => { finishSave([task]); await mutation; });
  await act(async () => finishRead([]));
  expect(state.tasks).toEqual([task]);
  expect(state.busy).toBe(false);
});

it("retains tasks and hides sensitive transport details when a mutation fails", async () => {
  vi.mocked(scheduledTasksApi.request).mockResolvedValueOnce([task]);
  await render();
  vi.mocked(scheduledTasksApi.request).mockRejectedValueOnce(new Error("secret path C:\\private\\token"));
  await act(async () => { expect(await state.mutate({ operation: "delete", id: task.id })).toBe(false); });
  expect(state.tasks).toEqual([task]);
  expect(state.error).toBe("操作未完成，请稍后重试。");
});
