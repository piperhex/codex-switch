import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const FOLLOW_SCROLL_DISTANCE = 100;

export function useFollowScroll(selected: string | null, active = true) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const jumpToLatest = useCallback(() => {
    follow.current = true;
    setAway(false);
    if (viewport.current) viewport.current.scrollTo({ top: viewport.current.scrollHeight });
  }, []);
  const pauseFollowing = useCallback(() => { follow.current = false; setAway(true); }, []);
  useLayoutEffect(() => { if (active) jumpToLatest(); }, [selected, active, jumpToLatest]);
  useEffect(() => {
    if (!content.current) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    observer.observe(content.current);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const node = viewport.current;
    if (!node) return;
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_SCROLL_DISTANCE;
    setAway(!follow.current);
  };
  return { viewport, content, away, onScroll, jumpToLatest, pauseFollowing };
}
