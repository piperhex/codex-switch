import type { ErrorLogEntry, ErrorLogPage } from "../../api/errorLogs";

export const ERROR_LOG_RETENTION_LIMIT = 5_000;

export function mergeLatestLogPage(current: ErrorLogPage, latest: ErrorLogPage): ErrorLogPage {
  if (!current.entries.length || !latest.entries.length) return latest;
  const newestId = current.entries[0].id;
  if (latest.entries[0].id < newestId) return latest;
  const overlaps = latest.entries.some((entry) => entry.id <= newestId);
  // A burst can exceed one page. Reset to the latest page so loading more never skips the gap.
  if (!overlaps) return latest;
  return {
    entries: mergeLogEntries(current.entries, latest.entries),
    hasMore: current.hasMore,
  };
}

export function mergeLogEntries(current: ErrorLogEntry[], incoming: ErrorLogEntry[]): ErrorLogEntry[] {
  const entries = new Map(current.map((entry) => [entry.id, entry]));
  incoming.forEach((entry) => entries.set(entry.id, entry));
  return [...entries.values()]
    .sort((left, right) => right.id - left.id)
    .slice(0, ERROR_LOG_RETENTION_LIMIT);
}
