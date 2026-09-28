import { useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "codex-switch:gui-skin";
const CHANGE_EVENT = "codex-switch:gui-skin-changed";
export const DEFAULT_GUI_SKIN_OPACITY = 0.8;
export type GuiSkin = {
  mode: "inherit" | "custom" | "none";
  themeId: string | null;
  overlayOpacity: number;
  imageRevision: number;
};
const DEFAULT_GUI_SKIN: GuiSkin = {
  mode: "inherit", themeId: null, overlayOpacity: DEFAULT_GUI_SKIN_OPACITY, imageRevision: 0,
};

function readSnapshot(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch { return null; }
}

function parseSkin(saved: string | null): GuiSkin {
  try {
    const value: unknown = saved === null ? null : JSON.parse(saved);
    if (!value || typeof value !== "object") return DEFAULT_GUI_SKIN;
    const { mode, themeId, overlayOpacity, imageRevision } = value as Record<string, unknown>;
    return {
      mode: mode === "custom" || mode === "none" ? mode : "inherit",
      themeId: typeof themeId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(themeId) ? themeId : null,
      overlayOpacity: typeof overlayOpacity === "number" && Number.isFinite(overlayOpacity)
        ? Math.min(1, Math.max(0, overlayOpacity)) : DEFAULT_GUI_SKIN_OPACITY,
      imageRevision: typeof imageRevision === "number" && Number.isSafeInteger(imageRevision) ? imageRevision : 0,
    };
  } catch { return DEFAULT_GUI_SKIN; }
}

export function saveGuiSkin(patch: Partial<GuiSkin>): boolean {
  try {
    const next = parseSkin(JSON.stringify({ ...parseSkin(readSnapshot()), ...patch }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch { return false; }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useGuiSkin() {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => null);
  return useMemo(() => parseSkin(snapshot), [snapshot]);
}
