import { useCallback, useEffect, useState } from "react";
import {
  applyThemeMode,
  isThemeModeStorageEvent,
  loadThemeMode,
  persistThemeMode,
  type ThemeMode,
} from "../utils/themeMode";

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const initialMode = loadThemeMode();
    applyThemeMode(initialMode);
    return initialMode;
  });

  const setMode = useCallback((nextMode: ThemeMode) => {
    persistThemeMode(nextMode);
    applyThemeMode(nextMode);
    setModeState(nextMode);
  }, []);

  useEffect(() => {
    const syncMode = (event: StorageEvent) => {
      if (!isThemeModeStorageEvent(event)) return;
      const nextMode = loadThemeMode();
      applyThemeMode(nextMode);
      setModeState(nextMode);
    };
    window.addEventListener("storage", syncMode);
    return () => window.removeEventListener("storage", syncMode);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  return { mode, setMode, toggleMode };
}
