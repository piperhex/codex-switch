import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCodexThreads, loadCodexThreadTokens } from "../../api/backend";
import type { CodexThreadEntry, CodexThreadKind, CodexThreadTokenTotals } from "../../types";
import { groupThreads } from "./utils";

const SEARCH_DELAY_MS = 300;

export function useThreadList(reportError: (error: unknown) => void) {
  const [threads, setThreads] = useState<CodexThreadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [kind, setKind] = useState<CodexThreadKind | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<Record<string, CodexThreadTokenTotals>>({});
  const latestReadRef = useRef(0);
  const searchDelayRef = useRef<number | null>(null);

  const refresh = useCallback(async (nextQuery: string, silent = false) => {
    if (!silent) setLoading(true);
    const requestId = latestReadRef.current + 1;
    latestReadRef.current = requestId;
    try {
      const result = await loadCodexThreads({ titleQuery: nextQuery, contentQuery: nextQuery });
      if (requestId !== latestReadRef.current) return;
      setThreads(result);
      const normalizedQuery = nextQuery.trim();
      setAppliedQuery(normalizedQuery);
      if (!silent) setExpanded(normalizedQuery ? new Set(result.map((item) => item.cwd)) : new Set());
      setSelected((current) => new Set(
        [...current].filter((id) => result.some((item) => item.sessionId === id)),
      ));
    } catch (error) {
      if (!silent) reportError(error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportError]);

  useEffect(() => { void refresh(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (searchDelayRef.current !== null) window.clearTimeout(searchDelayRef.current);
  }, []);

  const visibleThreads = useMemo(
    () => kind === "all" ? threads : threads.filter((item) => item.sessionKind === kind),
    [kind, threads],
  );
  const groups = useMemo(() => groupThreads(visibleThreads), [visibleThreads]);
  const allVisibleSelected = visibleThreads.length > 0
    && visibleThreads.every((item) => selected.has(item.sessionId));
  const someVisibleSelected = visibleThreads.some((item) => selected.has(item.sessionId));

  const toggleAll = () => setSelected(
    allVisibleSelected ? new Set() : new Set(visibleThreads.map((item) => item.sessionId)),
  );
  const toggleThread = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleGroup = async (cwd: string, items: CodexThreadEntry[]) => {
    const next = new Set(expanded);
    if (next.has(cwd)) next.delete(cwd);
    else next.add(cwd);
    setExpanded(next);
    if (expanded.has(cwd)) return;
    const missing = items.map((item) => item.sessionId).filter((id) => !tokens[id]);
    if (!missing.length) return;
    try {
      const totals = await loadCodexThreadTokens(missing);
      setTokens((current) => ({
        ...current,
        ...Object.fromEntries(totals.map((item) => [item.sessionId, item])),
      }));
    } catch {
      // Token details are optional; the session list remains usable if a rollout is incomplete.
    }
  };
  const cancelQueuedSearch = () => {
    if (searchDelayRef.current === null) return;
    window.clearTimeout(searchDelayRef.current);
    searchDelayRef.current = null;
  };
  const queueSearch = (nextQuery: string) => {
    cancelQueuedSearch();
    searchDelayRef.current = window.setTimeout(() => {
      searchDelayRef.current = null;
      void refresh(nextQuery);
    }, SEARCH_DELAY_MS);
  };
  const search = () => {
    cancelQueuedSearch();
    void refresh(query);
  };
  const clearSearch = () => {
    cancelQueuedSearch();
    setQuery("");
    void refresh("");
  };

  return {
    loading, query, setQuery, appliedQuery, kind, setKind, selected, setSelected, expanded, tokens,
    visibleThreads, groups, allVisibleSelected, someVisibleSelected, refresh, toggleAll, toggleThread,
    toggleGroup, queueSearch, search, clearSearch,
  };
}
