import { useEffect, type RefObject } from 'react';

type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };

/** Enter landscape once per desktop session. Keyboard visibility never changes the orientation lock. */
export function useDesktopOrientation(root: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    const element = root.current;
    const orientation = screen.orientation as LockableOrientation | undefined;
    if (!active || !element || !orientation?.lock) return;
    // The fullscreen element has a forced height. Keep the dialog free to follow the visual keyboard viewport.
    const fullscreenTarget = document.documentElement;
    let disposed = false;
    let ownsFullscreen = false;
    let locked = false;
    const restore = () => {
      if (locked) { orientation.unlock(); locked = false; }
      if (ownsFullscreen && document.fullscreenElement === fullscreenTarget) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
    const enter = async () => {
      try {
        if (!document.fullscreenElement && document.fullscreenEnabled) {
          await fullscreenTarget.requestFullscreen(); ownsFullscreen = true;
        }
        if (!disposed) { await orientation.lock!('landscape'); locked = true; }
      } catch { /* Browsers without orientation permission keep their normal responsive layout. */ }
      finally { if (disposed) restore(); }
    };
    void enter();
    return () => { disposed = true; restore(); };
  }, [root, active]);
}
