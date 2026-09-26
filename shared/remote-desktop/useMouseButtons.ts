import { useEffect, useRef, useState } from 'react';
import type { DesktopPointer } from './input';

const DRAG_DELAY = 500;

/** Long press also supports dragging with one finger; physical mouse users can keep holding the button. */
export function useMouseButtons(pointer: DesktopPointer) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const locked = useRef(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const unsubscribe = pointer.subscribe(() => {
      if (!pointer.isHeld('left')) { clearTimeout(timer.current); locked.current = false; setDragging(false); }
    });
    return () => { unsubscribe(); clearTimeout(timer.current); pointer.release(); };
  }, [pointer]);
  const down = (button: 'left' | 'right') => {
    if (button === 'left' && locked.current) {
      locked.current = false; setDragging(false); pointer.button('left', false); return;
    }
    pointer.button(button, true);
    if (button === 'left') timer.current = setTimeout(() => {
      locked.current = true; setDragging(true);
    }, DRAG_DELAY);
  };
  const up = (button: 'left' | 'right') => {
    if (button === 'left') clearTimeout(timer.current);
    if (button !== 'left' || !locked.current) pointer.button(button, false);
  };
  const cancel = () => {
    clearTimeout(timer.current); locked.current = false; setDragging(false);
    pointer.button('left', false); pointer.button('right', false);
  };
  return { down, up, cancel, dragging };
}
