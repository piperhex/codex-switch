import { useCallback, useEffect, useRef, useState } from "react";
import { scheduledTasksApi } from "./api";
import type { ScheduledTask, TaskRequest } from "./types";

const REFRESH_INTERVAL_MS = 10_000;
const LOAD_ERROR = "暂时无法加载定时任务，请稍后重试。";
const SAVE_ERROR = "操作未完成，请稍后重试。";

function errorMessage(error: unknown, fallback: string) {
  // Only our task command's short, user-facing messages are shown; transport failures use a safe fallback.
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return /^(暂时无法读取或保存定时任务|任务内容或时间有误|找不到这个任务|任务正在执行)/.test(message)
    ? message : fallback;
}

export function useScheduledTasks(active: boolean) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reading = useRef(false);
  const writing = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (reading.current || writing.current) return;
    reading.current = true;
    const version = revision.current;
    try {
      const result = await scheduledTasksApi.request({ operation: "list" });
      if (mounted.current && version === revision.current) { setTasks(result); setError(""); }
    } catch (cause) {
      if (mounted.current && version === revision.current) setError(errorMessage(cause, LOAD_ERROR));
    } finally {
      reading.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  const mutate = useCallback(async (request: Exclude<TaskRequest, { operation: "list" }>) => {
    if (writing.current) return false;
    writing.current = true;
    revision.current += 1;
    setBusy(true);
    setError("");
    try {
      const result = await scheduledTasksApi.request(request);
      if (mounted.current) setTasks(result);
      return true;
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, SAVE_ERROR));
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { tasks, loading, busy, error, refresh, mutate };
}
