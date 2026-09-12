export type Schedule =
  | { kind: "once"; at: number }
  | { kind: "interval"; minutes: number }
  | { kind: "daily" | "weekdays"; time: string }
  | { kind: "weekly"; time: string; weekday: number };

export type TaskStatus = "active" | "paused" | "completed";
export type TaskFilter = "all" | TaskStatus;
export interface TaskInput { title: string; prompt: string; cwd: string; schedule: Schedule }
export interface ScheduledTask extends TaskInput {
  id: string;
  status: TaskStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastThreadId: string | null;
  lastTurnId: string | null;
  runStatus: "idle" | "starting" | "running";
  error: string | null;
}
export type TaskRequest =
  | { operation: "list" }
  | { operation: "save"; id: string | null; input: TaskInput }
  | { operation: "setStatus"; id: string; status: "active" | "paused" }
  | { operation: "delete" | "runNow"; id: string };

export const TASK_FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "全部" }, { value: "active", label: "已开启" },
  { value: "paused", label: "已暂停" }, { value: "completed", label: "已完成" },
];
export const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

export function scheduleLabel(schedule: Schedule): string {
  switch (schedule.kind) {
    case "once": return new Date(schedule.at).toLocaleString("zh-CN", { month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false });
    case "interval": return `每 ${schedule.minutes} 分钟`;
    case "daily": return `每天 ${schedule.time}`;
    case "weekdays": return `工作日 ${schedule.time}`;
    case "weekly": return `${WEEKDAYS[schedule.weekday]} ${schedule.time}`;
  }
}

export function filterTasks(tasks: ScheduledTask[], filter: TaskFilter, search: string) {
  const query = search.trim().toLocaleLowerCase();
  return tasks.filter((task) => (filter === "all" || task.status === filter)
    && `${task.title}\n${task.prompt}`.toLocaleLowerCase().includes(query));
}

/** Keep persisted execution state out of the editable request boundary. */
export function taskInput({ title, prompt, cwd, schedule }: TaskInput): TaskInput {
  return { title, prompt, cwd, schedule };
}