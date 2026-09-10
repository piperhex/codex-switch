import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { messageWindow, type MessageCursor } from "./messageWindow";
import type { Turn } from "./types";

const LOAD_DISTANCE = 100;
const EMPTY_TURNS: Turn[] = [];
interface Options {
  turns?: Turn[];
  selected: string | null;
  active: boolean;
  viewport: RefObject<HTMLDivElement>;
  pauseFollowing: () => void;
}

export function useMessageWindow({ turns = EMPTY_TURNS, selected, active, viewport, pauseFollowing }: Options) {
  const [window, setWindow] = useState<{ selected: string | null; active: boolean; start?: MessageCursor }>(
    { selected, active });
  const [loading, setLoading] = useState(false);
  const frame = useRef<number>();
  const position = useRef(0);
  const anchor = useRef<{ node: Element; top: number }>();
  const current = window.selected === selected && window.active === active;
  const start = current && active ? window.start : undefined;
  const range = useMemo(() => messageWindow(turns, { start }), [turns, start]);
  const latest = useRef({ turns, range, selected, active });
  latest.current = { turns, range, selected, active };

  useLayoutEffect(() => {
    const changed = window.start?.turnId !== range.start?.turnId || window.start?.itemId !== range.start?.itemId;
    if (!current || (active && changed)) {
      setWindow({ selected, active, start: active ? range.start : undefined });
    }
  }, [selected, active, current, window.start, range.start]);

  useLayoutEffect(() => {
    anchor.current = undefined;
    position.current = viewport.current?.scrollTop ?? 0;
    setLoading(false);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [selected, active, viewport]);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (node && anchor.current?.node.isConnected) {
      node.scrollTop += anchor.current.node.getBoundingClientRect().top - anchor.current.top;
      position.current = node.scrollTop;
    }
    if (!loading) anchor.current = undefined;
  }, [range, loading, viewport]);

  const loadOlder = () => {
    const node = viewport.current;
    if (!node || !active || !range.hasMore || frame.current !== undefined) return;
    const top = node.getBoundingClientRect().top;
    const visible = [...node.querySelectorAll("[data-message-id], [data-history-anchor]")]
      .find((entry) => entry.getClientRects().length > 0 && entry.getBoundingClientRect().bottom > top);
    if (visible) anchor.current = { node: visible, top: visible.getBoundingClientRect().top };
    pauseFollowing();
    setLoading(true);
    // Allow the loading indicator to paint before mounting another batch of rich message components.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        const next = latest.current;
        if (next.selected !== selected || !next.active) return;
        setWindow({ selected, active, start: messageWindow(next.turns, { start: next.range.start, older: true }).start });
        setLoading(false);
      });
    });
  };
  const onScroll = () => {
    const top = viewport.current?.scrollTop ?? 0;
    const upward = top < position.current;
    position.current = top;
    if (upward && top < LOAD_DISTANCE) loadOlder();
  };
  return { entries: range.entries, hasMore: range.hasMore, loading, onScroll, loadOlder };
}
