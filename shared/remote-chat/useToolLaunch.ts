import { useEffect, useRef } from 'react';

/** A menu request opens the existing tool without remounting its retained sessions. */
export function useToolLaunch(request: number, open: () => void, enabled = true) {
  const previous = useRef(request);
  useEffect(() => {
    if (previous.current === request || !enabled) return;
    previous.current = request;
    open();
  }, [request, open, enabled]);
}
