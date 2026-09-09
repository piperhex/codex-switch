import { useEffect, useState, type CSSProperties } from "react";
import { loadDreamSkinStatus, loadDreamSkinThemePreview } from "../../api/backend";
import type { DreamSkinStatus } from "../../types";
import { DREAM_SKIN_STATUS_CHANGED } from "../dreamSkin/statusEvents";

const DEFAULT_OVERLAY_OPACITY = 0.8;
type Skin = { status: DreamSkinStatus; image: string | null };
type SkinStyle = CSSProperties & Record<`--${string}`, string | number>;

export function dreamSkinStyle({ status, image }: Skin): SkinStyle | undefined {
  if (!status.installed || status.session === "paused" || !image) return undefined;
  const opacity = status.activeThemeOverlayOpacity;
  const overlay = typeof opacity === "number" && Number.isFinite(opacity)
    ? Math.min(1, Math.max(0, opacity)) : DEFAULT_OVERLAY_OPACITY;
  const style: SkinStyle = {
    "--gui-skin-image": `url(${JSON.stringify(image)})`,
    "--gui-skin-overlay": `${overlay * 100}%`,
  };
  const appearance = status.activeThemeAppearance;
  if (appearance === "light" || appearance === "dark") {
    const dark = appearance === "dark";
    Object.assign(style, {
      colorScheme: appearance,
      "--panel": dark ? "#17191c" : "#fbfcfa",
      "--bg": dark ? "#121416" : "#f6f8f7",
      "--ink": dark ? "#e6e8eb" : "#17211b",
      "--muted": dark ? "#a4abb5" : "#52635a",
      "--line": dark ? "#3e444b" : "#dfe5df",
      "--green-soft": dark ? "#1c3430" : "#e7f5f4",
      "--green-selection": dark ? "#25443e" : "#dbf0ef",
      "--green-selection-hover": dark ? "#213a35" : "#cfebea",
    });
  }
  return style;
}

export function useDreamSkin(active: boolean) {
  const [skin, setSkin] = useState<Skin | null>(null);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const apply = async (status: DreamSkinStatus, request: number) => {
      const enabled = status.installed && status.session !== "paused" && status.activeThemeId;
      try {
        const image = enabled ? await loadDreamSkinThemePreview(status.activeThemeId!) : null;
        if (!disposed && request === revision) setSkin({ status, image });
      } catch {
        // An unavailable image should leave the conversation readable with its ordinary theme.
        if (!disposed && request === revision) setSkin(null);
      }
    };
    const changed = (event: Event) => { void apply((event as CustomEvent<DreamSkinStatus>).detail, ++revision); };
    window.addEventListener(DREAM_SKIN_STATUS_CHANGED, changed);
    if (active) {
      const request = ++revision;
      void loadDreamSkinStatus().then((status) => {
        if (!disposed && request === revision) return apply(status, request);
      }).catch(() => { /* Keep the last usable theme when a status refresh is unavailable. */ });
    }
    return () => { disposed = true; window.removeEventListener(DREAM_SKIN_STATUS_CHANGED, changed); };
  }, [active]);
  return skin ? dreamSkinStyle(skin) : undefined;
}
