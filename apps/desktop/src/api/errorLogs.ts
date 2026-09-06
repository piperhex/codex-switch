import { hasLocalBackend, invoke } from "./backend";

export type ErrorLogSource = "proxy" | "toast";

export interface ErrorLogEntry {
  id: number;
  createdAt: string;
  source: ErrorLogSource;
  message: string;
  statusCode?: number | null;
}

export interface ErrorLogPage {
  entries: ErrorLogEntry[];
  hasMore: boolean;
}

interface ErrorLogQuery {
  limit?: number;
  beforeId?: number;
  source?: ErrorLogSource;
}

export async function listErrorLogs(query: ErrorLogQuery = {}): Promise<ErrorLogPage> {
  if (!hasLocalBackend) return { entries: [], hasMore: false };
  return invoke<ErrorLogPage>("list_error_logs", { ...query });
}

export async function clearErrorLogs(): Promise<void> {
  if (hasLocalBackend) await invoke("clear_error_logs");
}

export async function recordToastLog(message: string): Promise<void> {
  if (hasLocalBackend && message.trim()) await invoke("record_toast_log", { message });
}
