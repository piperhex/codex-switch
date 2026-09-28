import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point, DesktopViewport } from './geometry';
import type { DesktopPointer } from './input';
import type { MousePanelActivity } from './useMousePanel';
import { ScrollPadController, type DesktopWheel } from './scrollPad';

export interface ScrollPadProps {
  pointer: DesktopPointer; viewport: DesktopViewport; panel: MousePanelActivity;
  wheel: DesktopWheel; horizontal: boolean; close: () => void;
}
export function useScrollPad({ wheel, horizontal, close, panel, pointer, viewport }: ScrollPadProps) {
  const callbacks = useRef({ wheel, close }); callbacks.current = { wheel, close };
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const controller = useMemo(() => new ScrollPadController({ horizontal, change: setPosition,
    wheel: (delta, axis) => callbacks.current.wheel(delta, axis),
    close: () => callbacks.current.close() }), [horizontal]);
  useEffect(() => {
    pointer.release(); panel.hold('scroll', true);
    return () => { controller.stop(); panel.hold('scroll', false); };
  }, [controller, panel.hold, pointer]);
  useEffect(() => { controller.stop(); }, [controller, viewport.stage.width, viewport.stage.height]);
  return { controller, position };
}
