import { expect, it } from "vitest";
import { filterTasks, scheduleLabel, taskInput, type ScheduledTask } from "./types";

const task: ScheduledTask = {
  id: "task-1", title: "每周回顾", prompt: "总结版本发布进展", cwd: "", schedule: { kind: "weekly", time: "16:00", weekday: 4 },
  status: "paused", nextRunAt: null, lastRunAt: null, lastThreadId: "thread-1", lastTurnId: null,
  runStatus: "idle", error: null,
};

it("strips execution metadata before editing or sending a task", () => {
  expect(taskInput(task)).toEqual({ title: "每周回顾", prompt: "总结版本发布进展", cwd: "",
    schedule: { kind: "weekly", time: "16:00", weekday: 4 } });
  expect(JSON.stringify(taskInput(task))).not.toContain("lastThreadId");
});

it("combines status and case-insensitive search without exposing unrelated tasks", () => {
  const active = { ...task, id: "active", title: "Codex 发布", status: "active" as const };
  expect(filterTasks([task, active], "active", " codex ")).toEqual([active]);
  expect(filterTasks([task, active], "paused", "发布")).toEqual([task]);
  expect(filterTasks([task, active], "completed", "")).toEqual([]);
});

it("describes weekly, weekday and interval schedules with their actual times", () => {
  expect(scheduleLabel(task.schedule)).toBe("星期五 16:00");
  expect(scheduleLabel({ kind: "weekdays", time: "08:00" })).toBe("工作日 08:00");
  expect(scheduleLabel({ kind: "interval", minutes: 5 })).toBe("每 5 分钟");
});
