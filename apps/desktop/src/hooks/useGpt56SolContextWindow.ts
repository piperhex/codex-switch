import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW,
  loadGpt56SolContextWindow,
  MAX_GPT_5_6_SOL_CONTEXT_WINDOW,
  MIN_GPT_5_6_SOL_CONTEXT_WINDOW,
  updateGpt56SolContextWindow,
} from "../api/backend";

export const GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS_K = [128, 272, 384, 400, 1000] as const;
export const DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW_K = String(
  DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW / 1_000,
);

export type ModelContextWindowError = "invalid" | "save" | null;

function parseContextWindowK(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const contextWindow = Number(trimmed) * 1_000;
  return Number.isSafeInteger(contextWindow)
    && contextWindow >= MIN_GPT_5_6_SOL_CONTEXT_WINDOW
    && contextWindow <= MAX_GPT_5_6_SOL_CONTEXT_WINDOW
    ? contextWindow
    : null;
}

export function useGpt56SolContextWindow() {
  const [valueK, setValueK] = useState(DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW_K);
  const [saving, setSaving] = useState(true);
  const [error, setError] = useState<ModelContextWindowError>(null);
  const savedValueK = useRef(DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW_K);
  const pendingValueK = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadGpt56SolContextWindow()
      .then((contextWindow) => {
        if (!active) return;
        const loadedValueK = String(contextWindow / 1_000);
        savedValueK.current = loadedValueK;
        setValueK(loadedValueK);
      })
      .catch(() => {
        if (active) setError("save");
      })
      .finally(() => {
        if (active) setSaving(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const saveValueK = useCallback(async (candidate: string) => {
    const contextWindow = parseContextWindowK(candidate);
    if (contextWindow === null) {
      setValueK(savedValueK.current);
      setError("invalid");
      return;
    }
    const normalizedValueK = String(contextWindow / 1_000);
    if (normalizedValueK === savedValueK.current || normalizedValueK === pendingValueK.current) return;
    pendingValueK.current = normalizedValueK;
    setSaving(true);
    setError(null);
    try {
      const savedContextWindow = await updateGpt56SolContextWindow(contextWindow);
      const nextValueK = String(savedContextWindow / 1_000);
      savedValueK.current = nextValueK;
      setValueK(nextValueK);
    } catch {
      setValueK(savedValueK.current);
      setError("save");
    } finally {
      pendingValueK.current = null;
      setSaving(false);
    }
  }, []);

  const updateValueK = useCallback((nextValueK: string) => {
    setValueK(nextValueK);
    setError(null);
    if (GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS_K.some((value) => String(value) === nextValueK)) {
      void saveValueK(nextValueK);
    }
  }, [saveValueK]);

  return { valueK, saving, error, updateValueK, saveValueK };
}
