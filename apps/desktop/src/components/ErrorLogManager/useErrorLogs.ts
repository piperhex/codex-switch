import { useCallback, useEffect, useRef, useState } from "react";
import { clearErrorLogs, listErrorLogs, type ErrorLogPage, type ErrorLogSource } from "../../api/errorLogs";
import { mergeLatestLogPage, mergeLogEntries } from "./logEntries";

const LOG_PAGE_SIZE = 50;
const LOG_REFRESH_INTERVAL_MS = 2_000;
const EMPTY_PAGE: ErrorLogPage = { entries: [], hasMore: false };

export type ErrorLogFilter = "all" | ErrorLogSource;
type LogOperation = "refresh" | "poll" | "more" | "clear";

export function useErrorLogs() {
  const [filter, setFilter] = useState<ErrorLogFilter>("all");
  const [page, setPage] = useState(EMPTY_PAGE);
  const [operation, setOperation] = useState<LogOperation | null>(null);
  const [error, setError] = useState<"load" | "clear" | null>(null);
  const currentPage = useRef(EMPTY_PAGE);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pollingPaused = useRef(false);

  const updatePage = useCallback((nextPage: ErrorLogPage) => {
    currentPage.current = nextPage;
    setPage(nextPage);
  }, []);

  const load = useCallback(async (mode: "refresh" | "more" = "refresh", quiet = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const requestGeneration = generation.current;
    setOperation(quiet ? "poll" : mode);
    try {
      const current = currentPage.current;
      const beforeId = mode === "more" ? current.entries[current.entries.length - 1]?.id : undefined;
      const result = await listErrorLogs({
        limit: LOG_PAGE_SIZE, beforeId, source: filter === "all" ? undefined : filter,
      });
      if (generation.current !== requestGeneration) return;
      updatePage(mode === "more"
        ? { entries: mergeLogEntries(current.entries, result.entries), hasMore: result.hasMore }
        : mergeLatestLogPage(current, result));
      setError(null);
    } catch {
      if (generation.current === requestGeneration) setError("load");
    } finally {
      inFlight.current = false;
      if (generation.current === requestGeneration) setOperation(null);
    }
  }, [filter, updatePage]);

  useEffect(() => {
    generation.current += 1;
    updatePage(EMPTY_PAGE);
    setError(null);
    setOperation(null);
    void load();
    const timer = window.setInterval(() => {
      if (!pollingPaused.current) void load("refresh", true);
    }, LOG_REFRESH_INTERVAL_MS);
    return () => {
      generation.current += 1;
      window.clearInterval(timer);
    };
  }, [load, updatePage]);

  const clear = useCallback(async () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    const requestGeneration = generation.current;
    setOperation("clear");
    try {
      await clearErrorLogs();
      if (generation.current !== requestGeneration) return false;
      updatePage(EMPTY_PAGE);
      setError(null);
      return true;
    } catch {
      if (generation.current === requestGeneration) setError("clear");
      return false;
    } finally {
      inFlight.current = false;
      if (generation.current === requestGeneration) setOperation(null);
    }
  }, [updatePage]);

  const setPollingPaused = (paused: boolean) => { pollingPaused.current = paused; };
  return { ...page, filter, setFilter, operation, error, load, clear, setPollingPaused };
}
