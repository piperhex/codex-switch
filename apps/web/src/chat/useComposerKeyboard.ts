import { useEffect, useState } from 'react';

const KEYBOARD_HEIGHT = 100;

export function useComposerKeyboard(active: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    const viewport = window.visualViewport;
    let fullHeight = window.innerHeight;
    let pointerDown = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (pointerDown) return;
      fullHeight = Math.max(fullHeight, window.innerHeight);
      const focused = document.activeElement?.matches('.chat-composer textarea') ?? false;
      const touch = window.matchMedia('(pointer: coarse)').matches;
      // A mobile keyboard can close without blurring the textarea (for example Android Back).
      setVisible(focused && (!touch || !viewport || fullHeight - viewport.height > KEYBOARD_HEIGHT));
    };
    const press = () => { clearTimeout(releaseTimer); pointerDown = true; };
    // Keep targets still until the click finishes, including approval buttons above the composer.
    const release = () => {
      releaseTimer = setTimeout(() => { pointerDown = false; update(); }, 0);
    };
    const rotate = () => { fullHeight = window.innerHeight; update(); };
    update();
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', rotate);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', rotate);
    };
  }, [active]);
  return visible;
}
