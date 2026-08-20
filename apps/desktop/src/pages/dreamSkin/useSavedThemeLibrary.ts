import { useCallback, useState } from "react";
import type { SavedThemeLibrary, ThemeActions } from "./types";

export function useSavedThemeLibrary(
  deleteThemes: ThemeActions["deleteSavedThemes"],
): SavedThemeLibrary {
  const [query, setQuery] = useState("");
  const [selectedThemeIds, setSelectedThemeIds] = useState<string[]>([]);

  const toggleTheme = useCallback((themeId: string, selected: boolean) => {
    setSelectedThemeIds((current) => selected
      ? [...new Set([...current, themeId])]
      : current.filter((id) => id !== themeId));
  }, []);

  const deleteSelectedThemes = useCallback(async () => {
    if (selectedThemeIds.length === 0) return;
    if (await deleteThemes(selectedThemeIds)) setSelectedThemeIds([]);
  }, [deleteThemes, selectedThemeIds]);

  return { query, selectedThemeIds, deleteSelectedThemes, setQuery, toggleTheme };
}
