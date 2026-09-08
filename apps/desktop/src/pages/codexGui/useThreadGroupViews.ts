import { useEffect, useState } from "react";

const STORAGE_KEY = "codex-switch:gui-thread-groups";
interface GroupViews { collapsed: string[]; expanded: string[] }

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function loadViews(): GroupViews {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      const saved = parsed as Record<string, unknown>;
      return { collapsed: stringList(saved.collapsed), expanded: stringList(saved.expanded) };
    }
  } catch { /* Folding also works when stored preferences are unavailable. */ }
  return { collapsed: [], expanded: [] };
}

export function useThreadGroupViews() {
  const [views, setViews] = useState(loadViews);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(views)); }
    catch { /* Keep the current in-memory view if storage is full or unavailable. */ }
  }, [views]);
  const toggle = (field: keyof GroupViews, key: string) => setViews((current) => ({
    ...current,
    [field]: current[field].includes(key) ? current[field].filter((value) => value !== key) : [...current[field], key],
  }));
  return { views, toggle };
}
