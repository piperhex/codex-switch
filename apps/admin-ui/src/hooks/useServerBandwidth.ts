import { useCallback, useEffect, useRef, useState } from "react";
import type { TrafficApi } from "../chat-traffic-types";
import type { ServerBandwidth } from "../pages/server-bandwidth";

const REFRESH_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function useServerBandwidth(api: TrafficApi) {
  const [data, setData] = useState<ServerBandwidth>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let active: AbortController | undefined;
    const load = async () => {
      if (disposed || active || document.hidden) return;
      const controller = new AbortController();
      active = controller;
      setLoading(true);
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const value = await api<ServerBandwidth>("/admin/api/dashboard/bandwidth", {
          signal: controller.signal, cache: "no-store",
        });
        if (!disposed) { setData(value); setError(false); }
      } catch {
        if (!disposed) setError(true);
      } finally {
        clearTimeout(timeout);
        active = undefined;
        if (!disposed) setLoading(false);
      }
    };
    const resume = () => { if (!document.hidden) void load(); };
    refreshRef.current = load;
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      active?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [api]);

  return { data, loading, error, refresh };
}
