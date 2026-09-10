import { useEffect, useState } from 'react';
import type { Turn } from './types';

const SECOND_MS = 1000;

/** Use the PC timestamp when available and retain a fallback across streaming renders. */
export function useProcessingSeconds(turn: Turn | undefined, active = true) {
  const [clock, setClock] = useState(() => ({ id: turn?.id, start: Date.now(), now: Date.now() }));
  const running = turn?.status === 'inProgress';
  useEffect(() => {
    if (!running || !active) return;
    const tick = () => setClock((previous) => {
      const now = Date.now();
      return { id: turn?.id, start: previous.id === turn?.id ? previous.start : now, now };
    });
    tick();
    const timer = setInterval(tick, SECOND_MS);
    return () => clearInterval(timer);
  }, [turn?.id, running, active]);
  const start = turn?.startedAt == null ? clock.start : turn.startedAt * SECOND_MS;
  return Math.max(0, Math.floor((clock.now - start) / SECOND_MS));
}
