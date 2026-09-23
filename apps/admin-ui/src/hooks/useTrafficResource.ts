import { useCallback, useEffect, useRef, useState } from "react";
import type { TrafficApi } from "../chat-traffic-types";

const REFRESH_MS = 10_000;

/** Each mounted view owns one cancellable request and skips overlapping refreshes. */
export function useTrafficResource<T>(api: TrafficApi, path: string | null) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    setData(undefined);
    setError(false);
    if (!path) { setLoading(false); return; }
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      setLoading(true);
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(value); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    refreshRef.current = load;
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [api, path]);
  return { data, loading, error, refresh };
}
