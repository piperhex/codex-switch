import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  applyThemeMode,
  isThemeModeStorageEvent,
  loadThemeMode,
  persistThemeMode,
  type ThemeMode,
} from "../utils/themeMode";

export function useThemeMode(override?: ThemeMode) {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);
  const appliedMode = override ?? mode;
  useLayoutEffect(() => applyThemeMode(appliedMode), [appliedMode]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    persistThemeMode(nextMode);
    setModeState(nextMode);
  }, []);

  useEffect(() => {
    const syncMode = (event: StorageEvent) => {
      if (!isThemeModeStorageEvent(event)) return;
      const nextMode = loadThemeMode();
      setModeState(nextMode);
    };
    window.addEventListener("storage", syncMode);
    return () => window.removeEventListener("storage", syncMode);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  return { mode, appliedMode, setMode, toggleMode };
}
