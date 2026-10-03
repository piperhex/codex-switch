import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import type { DesktopViewport } from '../../../../../shared/remote-desktop/geometry';
import type { MousePanelActivity } from '../../../../../shared/remote-desktop/useMousePanel';
import { useMouseButtons as useSharedMouseButtons } from '../../../../../shared/remote-desktop/useMouseButtons';

type Button = 'left' | 'right';
interface Press { id: number; x: number; y: number }

export function useMouseButtons(pointer: DesktopPointer, viewport: DesktopViewport, panel: MousePanelActivity) {
  const buttons = useSharedMouseButtons(pointer);
  const presses = useRef<Partial<Record<Button, Press>>>({});
  const cancel = useCallback(() => {
    presses.current = {}; buttons.cancel(); panel.hold('left', false); panel.hold('right', false);
  }, [buttons.cancel, panel.hold]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', hidden);
    return () => {
      cancel(); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden);
    };
  }, [cancel]);
  const move = (button: Button, event: PointerEvent<HTMLButtonElement>) => {
    const previous = presses.current[button];
    if (previous?.id !== event.pointerId) return;
    if (button === 'left') buttons.move(event.clientX - previous.x, event.clientY - previous.y, viewport);
    presses.current[button] = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const handlers = (button: Button) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || presses.current[button]) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      presses.current[button] = { id: event.pointerId, x: event.clientX, y: event.clientY };
      panel.hold(button, true); buttons.down(button);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => move(button, event),
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (presses.current[button]?.id !== event.pointerId) return;
      move(button, event); delete presses.current[button]; buttons.up(button); panel.hold(button, false);
    },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
      if (presses.current[button]?.id === event.pointerId) cancel();
    },
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => {
      if (presses.current[button]?.id === event.pointerId) cancel();
    },
  });
  return { ...buttons, cancel, handlers };
}
