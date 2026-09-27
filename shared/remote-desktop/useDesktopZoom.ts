import { useEffect, useRef, useState } from 'react';
import type { DesktopViewport } from './geometry';
import { pinchDesktopViewport, startDesktopPinch, type DesktopPinch, type DesktopZoom } from './zoom';

/** Reset on rotation, stream aspect changes or close; keep zoom local to the viewer. */
export function useDesktopZoom(base: DesktopViewport, active: boolean) {
  const dimensions = [base.stage.width, base.stage.height, base.content.width, base.content.height].join(':');
  const [manual, setManual] = useState<{ dimensions: string; viewport: DesktopViewport; pinching: boolean }>();
  const pinch = useRef<{ dimensions: string; value: DesktopPinch }>();
  useEffect(() => {
    pinch.current = undefined; setManual(undefined);
  }, [active, dimensions]);
  const current = active && manual?.dimensions === dimensions ? manual : undefined;
  const modified = !!current && (current.pinching || current.viewport.content.width > base.content.width);
  const gestures: DesktopZoom = {
    start: (points, viewport) => {
      if (!active) return;
      pinch.current = { dimensions, value: startDesktopPinch(points, viewport) };
      setManual({ dimensions, viewport, pinching: true });
    },
    move: points => {
      if (!active || pinch.current?.dimensions !== dimensions) return;
      setManual({ dimensions, viewport: pinchDesktopViewport(base, pinch.current.value, points), pinching: true });
    },
    end: () => {
      if (!pinch.current) return;
      pinch.current = undefined;
      setManual(previous => previous && { ...previous, pinching: false });
    },
  };
  return { viewport: current?.viewport ?? base, modified, gestures };
}
