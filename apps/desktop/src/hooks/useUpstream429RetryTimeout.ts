import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
  loadAppSettings,
  MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
  MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
  updateUpstream429RetryTimeout,
} from "../api/backend";

function normalizeTimeout(value: unknown, fallback: number) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(
    MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
    Math.max(MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS, Math.round(parsed)),
  );
}

export function useUpstream429RetryTimeout(notify: (message: string) => void) {
  const timeoutRef = useRef(DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS);
  const requestIdRef = useRef(0);
  const [timeoutSeconds, setTimeoutSeconds] = useState(timeoutRef.current);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((value: number) => {
    timeoutRef.current = value;
    setTimeoutSeconds(value);
  }, []);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (!active) return;
        apply(normalizeTimeout(
          settings.upstream429RetryTimeoutSeconds,
          DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
        ));
      })
      .catch((error) => {
        if (active) notify(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [apply, notify]);

  const update = useCallback(async (value: number | string | null) => {
    const requestId = ++requestIdRef.current;
    const previous = timeoutRef.current;
    const next = normalizeTimeout(value, previous);
    apply(next);
    setLoading(true);
    try {
      const settings = await updateUpstream429RetryTimeout(next);
      if (requestId === requestIdRef.current) {
        apply(normalizeTimeout(settings.upstream429RetryTimeoutSeconds, next));
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        apply(previous);
        notify(String(error));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [apply, notify]);

  return { loading, timeoutSeconds, update };
}
