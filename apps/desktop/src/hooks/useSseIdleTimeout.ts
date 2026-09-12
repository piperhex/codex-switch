import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SSE_IDLE_TIMEOUT,
  loadSseIdleTimeout,
  MAX_SSE_IDLE_TIMEOUT_SECONDS,
  saveSseIdleTimeout,
  type SseIdleTimeoutSettings,
} from "../api/sseIdleTimeout";

export function useSseIdleTimeout(notify: (message: string) => void) {
  const [settings, setSettings] = useState(DEFAULT_SSE_IDLE_TIMEOUT);
  const [loading, setLoading] = useState(true);
  const busy = useRef(true);
  const mounted = useRef(false);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void loadSseIdleTimeout()
      .then((saved) => { if (active) setSettings(saved); })
      .catch((error: unknown) => { if (active) notify(String(error)); })
      .finally(() => {
        if (active) { busy.current = false; setLoading(false); }
      });
    return () => { active = false; mounted.current = false; };
  }, [notify]);

  const update = useCallback(async (next: SseIdleTimeoutSettings) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const saved = await saveSseIdleTimeout(next);
      if (mounted.current) setSettings(saved);
    } catch (error) {
      if (mounted.current) notify(String(error));
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [notify]);

  const updateSeconds = (value: number | string | null) => {
    if (value === null || value === "") return;
    const seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SSE_IDLE_TIMEOUT_SECONDS) return;
    void update({ ...settings, timeoutSeconds: seconds });
  };

  return {
    settings,
    loading,
    updateEnabled: (enabled: boolean) => { void update({ ...settings, enabled }); },
    updateSeconds,
  };
}
