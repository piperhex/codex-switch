import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { desktopPoint, type DesktopViewport } from '../../../../../shared/remote-desktop/geometry';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import type { DesktopInput } from '../../../../../shared/remote-desktop/protocol';

export function useHardwarePointer() {
  const [hardware, setHardware] = useState(() => window.matchMedia('(any-pointer: fine)').matches);
  useEffect(() => {
    const media = window.matchMedia('(any-pointer: fine)');
    const update = () => setHardware(media.matches);
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  return hardware;
}
interface Options {
  pointer: DesktopPointer; viewport: DesktopViewport; input: (input: DesktopInput) => void; focus: () => void;
}
const BUTTONS = ['left', 'middle', 'right'] as const;
export function useDesktopMouse({ pointer, viewport, input, focus }: Options) {
  const captured = useRef<number>();
  const wheelRemainder = useRef(0);
  useEffect(() => {
    const release = () => { captured.current = undefined; pointer.release(); };
    const hidden = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release); document.addEventListener('visibilitychange', hidden);
    return () => { release(); window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden); };
  }, [pointer]);
  const move = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }, outside = false) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = desktopPoint({ x: event.clientX - bounds.x, y: event.clientY - bounds.y }, viewport, outside);
    if (point) pointer.absolute(point.x, point.y, false);
    return !!point;
  };
  const release = () => { captured.current = undefined; pointer.release(); };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      const button = BUTTONS[event.button];
      if (!button || !move(event)) return;
      event.preventDefault(); focus(); captured.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId); pointer.button(button, true);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => { move(event, captured.current === event.pointerId); },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const button = BUTTONS[event.button];
      if (!button) return;
      move(event, captured.current === event.pointerId); pointer.button(button, false);
    },
    onPointerCancel: release,
    onLostPointerCapture: release,
    onWheel: (event: WheelEvent<HTMLDivElement>) => {
      if (!move(event)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.stage.height : 1;
      wheelRemainder.current += event.deltaY * unit;
      const delta = Math.max(-1200, Math.min(1200, -Math.round(wheelRemainder.current)));
      if (!delta) return;
      wheelRemainder.current += delta; pointer.flush(); input({ kind: 'wheel', delta });
    },
  };
}
