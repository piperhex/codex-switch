import { useCallback, useEffect, useRef, useState } from "react";
import { clearErrorLogs, listErrorLogs, type ErrorLogSource } from "../../api/errorLogs";
import { EMPTY_LOG_PAGE, LOG_DEFAULT_PAGE_SIZE } from "./pagination";

const LOG_REFRESH_INTERVAL_MS = 2_000;
export type ErrorLogFilter = "all" | ErrorLogSource;
type LogOperation = "refresh" | "poll" | "clear";
interface LogView { filter: ErrorLogFilter; page: number; pageSize: number }
const INITIAL_VIEW: LogView = { filter: "all", page: 1, pageSize: LOG_DEFAULT_PAGE_SIZE };

export function useErrorLogs() {
  const [view, setView] = useState(INITIAL_VIEW);
  const [data, setData] = useState(EMPTY_LOG_PAGE);
  const [operation, setOperation] = useState<LogOperation | null>(null);
  const [error, setError] = useState<"load" | "clear" | null>(null);
  const currentView = useRef(INITIAL_VIEW);
  const snapshotId = useRef<number | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const pollingPaused = useRef(false);

  const load = useCallback(async (quiet = false): Promise<void> => {
    if (!active.current) return;
    if (inFlight.current) { if (!quiet) pending.current = true; return; }
    inFlight.current = true;
    const requestGeneration = generation.current;
    const requested = currentView.current;
    setOperation(quiet ? "poll" : "refresh");
    try {
      const result = await listErrorLogs({
        limit: requested.pageSize, source: requested.filter === "all" ? undefined : requested.filter,
        pagination: { page: requested.page, snapshotId: requested.page === 1 ? null : snapshotId.current },
      });
      if (!active.current || generation.current !== requestGeneration) return;
      snapshotId.current = result.snapshotId;
      currentView.current = { ...requested, page: result.page };
      setView(currentView.current);
      setData(result);
      setError(null);
    } catch {
      if (active.current && generation.current === requestGeneration) setError("load");
    } finally {
      inFlight.current = false;
      if (active.current) setOperation(null);
      if (pending.current && active.current) {
        pending.current = false;
        void load();
      }
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    const timer = window.setInterval(() => {
      if (!pollingPaused.current && currentView.current.page === 1) void load(true);
    }, LOG_REFRESH_INTERVAL_MS);
    return () => {
      active.current = false;
      generation.current += 1;
      window.clearInterval(timer);
    };
  }, [load]);

  const navigate = useCallback((next: LogView) => {
    generation.current += 1;
    currentView.current = next;
    if (next.page === 1) snapshotId.current = null;
    setView(next);
    setData((previous) => ({ ...previous, entries: [] }));
    setError(null);
    setOperation("refresh");
    void load();
  }, [load]);

  const clear = useCallback(async () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setOperation("clear");
    try {
      await clearErrorLogs();
      if (!active.current) return false;
      snapshotId.current = null;
      currentView.current = { ...currentView.current, page: 1 };
      setView(currentView.current);
      setData(EMPTY_LOG_PAGE);
      setError(null);
      return true;
    } catch {
      if (active.current) setError("clear");
      return false;
    } finally {
      inFlight.current = false;
      if (active.current) setOperation(null);
    }
  }, []);

  const changePage = (page: number, pageSize: number) => navigate({
    ...currentView.current, page: pageSize === currentView.current.pageSize ? page : 1, pageSize,
  });
  const setFilter = (filter: ErrorLogFilter) => navigate({ ...currentView.current, filter, page: 1 });
  const refresh = () => navigate({ ...currentView.current, page: 1 });
  const setPollingPaused = (paused: boolean) => { pollingPaused.current = paused; };
  return { ...data, ...view, operation, error, refresh, clear, changePage, setFilter, setPollingPaused };
}
