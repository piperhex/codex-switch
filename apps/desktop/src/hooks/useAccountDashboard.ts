import { useCallback, useEffect, useRef, useState } from "react";
import { loadDashboard } from "../api/backend";
import type { Account, AppInfo } from "../types";

type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;

/** Coalesce account events, including one fresh read for changes arriving during a pending read. */
export function useAccountDashboard(notify: (message: string) => void) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const active = useRef(true);
  const refresh = useRef<{ pending?: Promise<Dashboard | undefined>; dirty: boolean }>({ dirty: false });

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; refresh.current.dirty = false; };
  }, []);

  const read = useCallback((): Promise<Dashboard | undefined> => {
    if (!active.current) return Promise.resolve(undefined);
    const state = refresh.current;
    state.dirty = true;
    if (state.pending) return state.pending;
    // Defer the first read too, so changes delivered in the same event batch share its snapshot.
    state.pending = Promise.resolve().then(async () => {
      let dashboard: Dashboard | undefined;
      try {
        while (active.current && state.dirty) {
          state.dirty = false;
          try {
            dashboard = await loadDashboard();
            if (!active.current || state.dirty) continue;
            setAccounts(dashboard.accounts);
            setInfo(dashboard.info);
          } catch (error) {
            dashboard = undefined;
            if (active.current && !state.dirty) notify(String(error));
          }
        }
        return dashboard;
      } finally {
        // Clear in the same microtask as the last dirty check, before the returned promise settles.
        state.pending = undefined;
        if (active.current) setLoading(false);
      }
    });
    return state.pending;
  }, [notify]);

  const reload = useCallback(async () => { await read(); }, [read]);
  return { accounts, setAccounts, info, loading, read, reload };
}
