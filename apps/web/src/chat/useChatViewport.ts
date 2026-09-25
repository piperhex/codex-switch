import { useEffect } from 'react';

// WebKit can publish the final geometry after resize/focus events and keyboard animations.
const VIEWPORT_SETTLE_MS = 750;

function createViewportSync() {
  const root = document.documentElement;
  let frame = 0;
  let settleUntil = 0;
  const update = () => {
    const viewport = window.visualViewport;
    const properties = {
      '--chat-height': `${viewport?.height ?? window.innerHeight}px`,
      '--chat-top': `${viewport?.offsetTop ?? 0}px`,
    };
    for (const [name, value] of Object.entries(properties)) {
      if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
    }
  };
  const settle = () => {
    frame = 0;
    update();
    if (performance.now() < settleUntil) frame = requestAnimationFrame(settle);
  };
  const schedule = () => {
    update();
    settleUntil = performance.now() + VIEWPORT_SETTLE_MS;
    if (!frame) frame = requestAnimationFrame(settle);
  };
  const cancel = () => {
    cancelAnimationFrame(frame);
    root.style.removeProperty('--chat-height');
    root.style.removeProperty('--chat-top');
  };
  return { schedule, cancel };
}

export function useChatViewport(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const sync = createViewportSync();
    const viewport = window.visualViewport;
    const windowEvents = ['resize', 'scroll', 'orientationchange', 'pageshow'];
    const focusEvents = ['focusin', 'focusout'];
    sync.schedule();
    viewport?.addEventListener('resize', sync.schedule);
    viewport?.addEventListener('scroll', sync.schedule);
    for (const name of windowEvents) window.addEventListener(name, sync.schedule);
    for (const name of focusEvents) document.addEventListener(name, sync.schedule);
    return () => {
      viewport?.removeEventListener('resize', sync.schedule);
      viewport?.removeEventListener('scroll', sync.schedule);
      for (const name of windowEvents) window.removeEventListener(name, sync.schedule);
      for (const name of focusEvents) document.removeEventListener(name, sync.schedule);
      sync.cancel();
    };
  }, [active]);
}
