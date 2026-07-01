import { useCallback, useEffect, useRef, useState } from "react";

const INTERVAL_KEY = "codex-auth-manager:auto-refresh-seconds";
const ENABLED_KEY = "codex-auth-manager:auto-refresh-enabled";
const DEFAULT_INTERVAL_SECONDS = 5;

export const MIN_AUTO_REFRESH_SECONDS = 1;
export const MAX_AUTO_REFRESH_SECONDS = 3600;

function clampInterval(value: unknown) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return DEFAULT_INTERVAL_SECONDS;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_INTERVAL_SECONDS;
  return Math.min(MAX_AUTO_REFRESH_SECONDS, Math.max(MIN_AUTO_REFRESH_SECONDS, Math.round(seconds)));
}

export function useAutoRefresh(active: boolean, onRefresh: () => Promise<void>) {
  const [seconds, setSeconds] = useState(() => clampInterval(window.localStorage.getItem(INTERVAL_KEY)));
  const [enabled, setEnabled] = useState(() => window.localStorage.getItem(ENABLED_KEY) === "true");
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const updateSeconds = useCallback((value: number | string | null) => {
    setSeconds(clampInterval(value));
  }, []);

  useEffect(() => window.localStorage.setItem(INTERVAL_KEY, String(seconds)), [seconds]);
  useEffect(() => window.localStorage.setItem(ENABLED_KEY, String(enabled)), [enabled]);

  useEffect(() => {
    if (!enabled || !active) return;
    const timer = window.setInterval(async () => {
      await refreshRef.current();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [active, enabled, seconds]);

  return { seconds, enabled, setEnabled, updateSeconds };
}
