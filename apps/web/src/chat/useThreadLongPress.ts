import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import { THREAD_LONG_PRESS_MS } from '../../../../shared/remote-chat/client/threadActions';

const MOVE_TOLERANCE_PX = 10;

/** Leave scrolling native and consume the click synthesized after a long press. */
export function useThreadLongPress(open: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const origin = useRef<{ x: number; y: number }>();
  const releaseClick = useRef<() => void>(() => {});
  const cancel = () => { clearTimeout(timer.current); timer.current = undefined; origin.current = undefined; };
  const consumeReleaseClick = () => {
    releaseClick.current();
    const consume = (event: globalThis.MouseEvent) => {
      event.preventDefault(); event.stopImmediatePropagation(); releaseClick.current();
    };
    const clear = () => {
      document.removeEventListener('click', consume, true);
      document.removeEventListener('pointerdown', clear, true);
    };
    releaseClick.current = clear;
    // Touch release can hit the newly opened backdrop, outside the original row.
    document.addEventListener('click', consume, true);
    document.addEventListener('pointerdown', clear, true);
  };
  useEffect(() => () => { cancel(); releaseClick.current(); }, []);
  return {
    onPointerDown: (event: PointerEvent) => {
      cancel(); releaseClick.current();
      if (event.button !== 0 || !event.isPrimary) return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => { consumeReleaseClick(); cancel(); open(); }, THREAD_LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y)
        > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent) => { event.preventDefault(); cancel(); consumeReleaseClick(); open(); },
  };
}
