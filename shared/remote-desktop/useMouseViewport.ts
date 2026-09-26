import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { DesktopPointer } from './input';
import { panDesktopViewport, type DesktopViewport, type Point, type Size } from './geometry';

/** Share the translated video rectangle with drawing, local cursor placement and input mapping. */
export function useMouseViewport(pointer: DesktopPointer, base: DesktopViewport, panel?: Size): DesktopViewport {
  const point = useSyncExternalStore(pointer.subscribe, pointer.getSnapshot);
  const previous = useRef<{ dimensions: string; offset: Point } | undefined>(undefined);
  const dimensions = [base.stage.width, base.stage.height, base.content.width, base.content.height].join(':');
  const offset = previous.current?.dimensions === dimensions ? previous.current.offset : { x: 0, y: 0 };
  const result = panel ? panDesktopViewport(base, point, panel, offset)
    : { viewport: base, offset: { x: 0, y: 0 } };
  useLayoutEffect(() => { previous.current = { dimensions, offset: result.offset }; },
    [dimensions, result.offset.x, result.offset.y]);
  return result.viewport;
}
