import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { websitePreviewSession } from "./websiteApi";

export function useWebsitePreview({ url, active, resizing }: { url: string; active: boolean; resizing: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ active, resizing });
  state.current = { active, resizing };
  const refresh = useRef<() => void>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const desktop = isTauri();
  useEffect(() => {
    const element = host.current;
    if (!desktop || !element) return;
    setFailed(false);
    const session = websitePreviewSession(() => setFailed(true));
    let frame = 0;
    let modalVisible = false;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        const visible = state.current.active && !state.current.resizing && !modalVisible && !document.hidden
          && bounds.width > 0 && bounds.height > 0;
        session.update({ url, visible, bounds: { x: Math.max(0, bounds.x), y: Math.max(0, bounds.y),
          width: bounds.width, height: bounds.height } });
      });
    };
    refresh.current = sync;
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    // Native child views sit above HTML, so hide them while an app dialog is open.
    const checkModal = () => {
      const visible = [...document.querySelectorAll('[aria-modal="true"]')]
        .some(dialog => dialog.getClientRects().length > 0);
      if (visible !== modalVisible) { modalVisible = visible; sync(); }
    };
    const overlays = new MutationObserver(checkModal);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class", "aria-modal"] });
    checkModal();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    document.addEventListener("visibilitychange", sync);
    document.addEventListener("animationend", sync, true);
    sync();
    return () => {
      refresh.current = undefined;
      cancelAnimationFrame(frame); observer.disconnect(); overlays.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      document.removeEventListener("visibilitychange", sync);
      document.removeEventListener("animationend", sync, true);
      void session.close().catch(error => console.error("Failed to close website preview", error));
    };
  }, [desktop, url, attempt]);
  useEffect(() => { refresh.current?.(); }, [active, resizing]);
  return { host, desktop, failed, attempt, retry: () => { setFailed(false); setAttempt(value => value + 1); },
    fail: () => setFailed(true) };
}
