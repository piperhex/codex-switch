import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { DesktopPointer } from './input';
import { panDesktopViewport, type DesktopPanState, type DesktopViewport, type Size } from './geometry';

/** Share the translated video rectangle with drawing, local cursor placement and input mapping. */
export function useMouseViewport(pointer: DesktopPointer, base: DesktopViewport, panel?: Size): DesktopViewport {
  const point = useSyncExternalStore(pointer.subscribe, pointer.getSnapshot);
  const previous = useRef<{ dimensions: string; pan: DesktopPanState } | undefined>(undefined);
  const dimensions = [base.stage.width, base.stage.height, base.content.width, base.content.height].join(':');
  const pan = previous.current?.dimensions === dimensions ? previous.current.pan : undefined;
  const result = panel ? panDesktopViewport(base, point, panel, pan)
    : { viewport: base, point, offset: { x: 0, y: 0 } };
  useLayoutEffect(() => { previous.current = { dimensions, pan: { offset: result.offset, point } }; },
    [dimensions, result.offset.x, result.offset.y, point]);
  return result.viewport;
}
