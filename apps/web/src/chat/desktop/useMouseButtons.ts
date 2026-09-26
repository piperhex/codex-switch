import { useEffect, useRef, useState } from 'react';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';

/** Long press also supports dragging with one finger; physical mouse users can keep holding the button. */
export function useMouseButtons(pointer: DesktopPointer) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const locked = useRef(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => {
    clearTimeout(timer.current); pointer.button('left', false); pointer.button('right', false);
  }, [pointer]);
  const down = (button: 'left' | 'right') => {
    if (button === 'left' && locked.current) {
      locked.current = false; setDragging(false); pointer.button('left', false); return;
    }
    pointer.button(button, true);
    if (button === 'left') timer.current = setTimeout(() => {
      locked.current = true; setDragging(true);
    }, 500);
  };
  const up = (button: 'left' | 'right') => {
    clearTimeout(timer.current);
    if (button !== 'left' || !locked.current) pointer.button(button, false);
  };
  const cancel = () => {
    clearTimeout(timer.current); locked.current = false; setDragging(false);
    pointer.button('left', false); pointer.button('right', false);
  };
  return { down, up, cancel, dragging };
}
