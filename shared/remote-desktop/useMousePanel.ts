import { useCallback, useEffect, useRef, useState } from 'react';

export const MOUSE_IDLE_DELAY = 4000;
export interface MousePanelActivity {
  expanded: boolean; expand: () => void; collapse: () => void;
  activity: () => void; hold: (key: string, down: boolean) => void;
}

/** A held button, finger or latched drag must not disappear beneath the user. */
export function useMousePanel(enabled: boolean): MousePanelActivity {
  const [expanded, setExpanded] = useState(true);
  const busy = useRef(new Set<string>());
  const active = useRef(enabled);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const activity = useCallback(() => {
    clearTimeout(timer.current);
    if (active.current && !busy.current.size) timer.current = setTimeout(() => setExpanded(false), MOUSE_IDLE_DELAY);
  }, []);
  const hold = useCallback((key: string, down: boolean) => {
    if (down) busy.current.add(key); else busy.current.delete(key);
    activity();
  }, [activity]);
  const expand = useCallback(() => { setExpanded(true); activity(); }, [activity]);
  const collapse = useCallback(() => { if (!busy.current.size) setExpanded(false); }, []);
  useEffect(() => {
    active.current = enabled; busy.current.clear();
    setExpanded(true); activity();
    return () => { active.current = false; clearTimeout(timer.current); busy.current.clear(); };
  }, [enabled, activity]);
  return { expanded, expand, collapse, activity, hold };
}
