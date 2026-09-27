import { useRef, type PointerEvent } from 'react';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import type { DesktopViewport, Point } from '../../../../../shared/remote-desktop/geometry';
import type { DesktopZoom, TouchPair } from '../../../../../shared/remote-desktop/zoom';

interface Options { pointer: DesktopPointer; viewport: DesktopViewport; zoom?: DesktopZoom }

export function usePinchZoom({ pointer, viewport, zoom }: Options) {
  const touches = useRef(new Map<number, Point>());
  const consumed = useRef(false);
  const update = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    touches.current.set(event.pointerId, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const points = (): TouchPair => { const [a, b] = touches.current.values(); return [a, b]; };
  return {
    start: (event: PointerEvent<HTMLElement>) => {
      if (!zoom || event.pointerType !== 'touch') return false;
      update(event); event.currentTarget.setPointerCapture(event.pointerId);
      if (touches.current.size === 2) {
        consumed.current = true; pointer.release(); zoom.start(points(), viewport);
      }
      return consumed.current;
    },
    move: (event: PointerEvent<HTMLElement>) => {
      if (touches.current.has(event.pointerId)) {
        update(event);
        if (touches.current.size >= 2) zoom?.move(points());
      }
      return consumed.current;
    },
    end: (event: PointerEvent<HTMLElement>) => {
      const pinched = consumed.current;
      const removed = touches.current.delete(event.pointerId);
      if (removed) {
        zoom?.end();
        if (touches.current.size >= 2) zoom?.start(points(), viewport);
      }
      if (touches.current.size === 0) consumed.current = false;
      return { pinched, pending: touches.current.size > 0 };
    },
    reset: () => { touches.current.clear(); consumed.current = false; zoom?.end(); },
  };
}
