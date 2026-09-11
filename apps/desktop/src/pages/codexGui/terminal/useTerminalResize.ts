import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.7;
const RESIZE_STEP = 24;

export function useTerminalResize(host: RefObject<HTMLElement>) {
  const [preferred, setPreferred] = useState(DEFAULT_HEIGHT);
  const [available, setAvailable] = useState(window.innerHeight);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; y: number; height: number }>();
  const maximum = Math.max(1, Math.round(available * MAX_HEIGHT_RATIO));
  const minimum = Math.min(MIN_HEIGHT, maximum);
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, Math.round(value)));
  const height = clamp(preferred);
  useEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent) return;
    setAvailable(parent.clientHeight);
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.height));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [host]);
  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none";
    return () => { document.body.style.cursor = cursor; document.body.style.userSelect = userSelect; };
  }, [dragging]);
  const cancel = () => { drag.current = undefined; setDragging(false); };
  return { height, minimum, maximum, handle: {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, y: event.clientY, height }; setDragging(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (drag.current?.pointer === event.pointerId) setPreferred(clamp(drag.current.height + drag.current.y - event.clientY));
    },
    onPointerUp: cancel, onPointerCancel: cancel, onLostPointerCapture: cancel,
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const values: Record<string, number> = { ArrowUp: height + RESIZE_STEP, ArrowDown: height - RESIZE_STEP,
        Home: minimum, End: maximum };
      if (!(event.key in values)) return;
      event.preventDefault(); setPreferred(clamp(values[event.key]));
    },
    onDoubleClick: () => setPreferred(DEFAULT_HEIGHT),
  } };
}
