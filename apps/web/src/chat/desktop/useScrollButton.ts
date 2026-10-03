import { useEffect, useRef, type PointerEvent } from 'react';
import type { ScrollPadGesture } from '../../../../../shared/remote-desktop/useScrollPad';

export function useScrollButton(scroll: ScrollPadGesture) {
  const press = useRef<{ id: number; x: number; y: number }>();
  useEffect(() => {
    const stop = () => { press.current = undefined; scroll.end(); };
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden);
    return () => {
      stop(); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden);
    };
  }, [scroll.end]);
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (press.current?.id !== event.pointerId) return;
    press.current = undefined; scroll.end();
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || press.current) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; scroll.start();
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const origin = press.current;
      if (origin?.id === event.pointerId) scroll.move({ x: event.clientX - origin.x, y: event.clientY - origin.y });
    },
    onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
  };
}
