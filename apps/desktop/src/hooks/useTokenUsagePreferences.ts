import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppSettings, updateTokenUsagePreferences } from "../api/backend";

export const DEFAULT_TOKEN_USAGE_WEEKS = 20;
export const MIN_TOKEN_USAGE_WEEKS = 1;
export const MAX_TOKEN_USAGE_WEEKS = 52;
export const DEFAULT_TOKEN_USAGE_REFRESH_SECONDS = 60;
export const MIN_TOKEN_USAGE_REFRESH_SECONDS = 1;
export const MAX_TOKEN_USAGE_REFRESH_SECONDS = 3_600;

interface TokenUsagePreferences {
  weeks: number;
  refreshSeconds: number;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizePreferences(settings: {
  tokenUsageWeeks?: number | null;
  tokenUsageRefreshSeconds?: number | null;
}): TokenUsagePreferences {
  return {
    weeks: clampInteger(
      settings.tokenUsageWeeks,
      MIN_TOKEN_USAGE_WEEKS,
      MAX_TOKEN_USAGE_WEEKS,
      DEFAULT_TOKEN_USAGE_WEEKS,
    ),
    refreshSeconds: clampInteger(
      settings.tokenUsageRefreshSeconds,
      MIN_TOKEN_USAGE_REFRESH_SECONDS,
      MAX_TOKEN_USAGE_REFRESH_SECONDS,
      DEFAULT_TOKEN_USAGE_REFRESH_SECONDS,
    ),
  };
}

export function useTokenUsagePreferences(notify: (message: string) => void) {
  const initial = useRef<TokenUsagePreferences>({
    weeks: DEFAULT_TOKEN_USAGE_WEEKS,
    refreshSeconds: DEFAULT_TOKEN_USAGE_REFRESH_SECONDS,
  });
  const preferencesRef = useRef(initial.current);
  const requestIdRef = useRef(0);
  const [preferences, setPreferences] = useState(initial.current);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((next: TokenUsagePreferences) => {
    preferencesRef.current = next;
    setPreferences(next);
  }, []);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) apply(normalizePreferences(settings));
      })
      .catch((error) => {
        if (active) notify(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apply, notify]);

  const persist = useCallback(async (next: TokenUsagePreferences) => {
    const requestId = ++requestIdRef.current;
    apply(next);
    setLoading(true);
    try {
      const saved = await updateTokenUsagePreferences(next.weeks, next.refreshSeconds);
      if (requestId === requestIdRef.current) apply(normalizePreferences(saved));
    } catch (error) {
      if (requestId === requestIdRef.current) notify(String(error));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [apply, notify]);

  const updateWeeks = useCallback((value: number | string | null) => {
    const weeks = clampInteger(
      value,
      MIN_TOKEN_USAGE_WEEKS,
      MAX_TOKEN_USAGE_WEEKS,
      preferencesRef.current.weeks,
    );
    void persist({ ...preferencesRef.current, weeks });
  }, [persist]);

  const updateRefreshSeconds = useCallback((value: number | string | null) => {
    const refreshSeconds = clampInteger(
      value,
      MIN_TOKEN_USAGE_REFRESH_SECONDS,
      MAX_TOKEN_USAGE_REFRESH_SECONDS,
      preferencesRef.current.refreshSeconds,
    );
    void persist({ ...preferencesRef.current, refreshSeconds });
  }, [persist]);

  return { ...preferences, loading, updateWeeks, updateRefreshSeconds };
}
