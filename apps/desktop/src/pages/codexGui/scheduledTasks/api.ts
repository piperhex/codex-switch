import { invoke } from "../../../api/backend";
import type { ScheduledTask, TaskRequest } from "./types";

export const scheduledTasksApi = {
  request: (request: TaskRequest) => invoke<ScheduledTask[]>("codex_gui_scheduled_tasks", { request }),
};
