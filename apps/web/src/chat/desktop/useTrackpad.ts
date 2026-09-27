import { useEffect, useRef, type PointerEvent } from 'react';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { desktopPoint, type DesktopViewport } from '../../../../../shared/remote-desktop/geometry';
import type { MousePanelActivity } from '../../../../../shared/remote-desktop/useMousePanel';
import type { DesktopZoom } from '../../../../../shared/remote-desktop/zoom';
import { usePinchZoom } from './usePinchZoom';

interface Options {
  pointer: DesktopPointer; viewport: DesktopViewport; direct?: boolean; click?: boolean;
  panel: MousePanelActivity; id: string; cancel?: () => void; zoom?: DesktopZoom;
}
export function useTrackpad({ pointer, viewport, direct, click = true, panel, id, cancel, zoom }: Options) {
  const pinch = usePinchZoom({ pointer, viewport, zoom });
  const gesture = useRef<{ id: number; x: number; y: number; distance: number; accepted: boolean }>();
  useEffect(() => () => {
    pinch.reset();
    if (!gesture.current) return;
    gesture.current = undefined; pointer.release(); panel.hold(id, false);
  }, [pointer, direct, panel.hold, id]);
  const point = (event: PointerEvent<HTMLElement>, outside = false) => {
    const bounds = event.currentTarget.closest('.rd-stage')!.getBoundingClientRect();
    return desktopPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, viewport, outside);
  };
  const end = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const { pinched, pending } = pinch.end(event);
    if (pinched) {
      if (!pending) { pointer.flush(); gesture.current = undefined; panel.hold(id, false); }
      return;
    }
    if (gesture.current?.id !== event.pointerId) return;
    if (cancelled) { pointer.release(); cancel?.(); }
    else if (direct) { if (gesture.current.accepted) pointer.button('left', false); }
    else if (click && gesture.current.distance < 5) pointer.click();
    pointer.flush(); gesture.current = undefined; panel.hold(id, false);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (pinch.start(event)) { event.preventDefault(); return; }
      if (gesture.current) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const target = direct ? point(event) : undefined;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, accepted: !!target };
      panel.hold(id, true);
      if (target) { pointer.absolute(target.x, target.y); pointer.button('left', true); }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (pinch.move(event)) return;
      const previous = gesture.current;
      if (!previous || previous.id !== event.pointerId) return;
      const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
      if (direct) {
        const target = previous.accepted && point(event, true);
        if (target) pointer.absolute(target.x, target.y);
      } else pointer.move(dx, dy, viewport.content.width - 1, viewport.content.height - 1);
      gesture.current = { ...previous, x: event.clientX, y: event.clientY,
        distance: previous.distance + Math.abs(dx) + Math.abs(dy) };
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => end(event, true),
  };
}
