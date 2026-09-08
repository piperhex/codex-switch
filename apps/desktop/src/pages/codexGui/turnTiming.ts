import type { Turn } from "./types";

export const SECOND_MS = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

export function restoreTurnTiming(turn: Turn, previous?: Turn): Turn {
  const completed = turn.status !== "inProgress" && previous?.status !== "inProgress";
  // Protocol timestamps are Unix seconds. Older CLI versions need an in-memory fallback.
  return { ...turn,
    startedAt: turn.startedAt ?? previous?.startedAt
      ?? (turn.status === "inProgress" ? Date.now() / SECOND_MS : undefined),
    completedAt: turn.completedAt ?? (completed ? previous?.completedAt : undefined),
    durationMs: turn.durationMs ?? (completed ? previous?.durationMs : undefined),
  };
}

export function completeTurnTiming(turn: Turn): Turn {
  const completedAt = turn.completedAt ?? Date.now() / SECOND_MS;
  return { ...turn, completedAt,
    durationMs: turn.durationMs ?? (turn.startedAt == null ? undefined
      : Math.max(0, Math.round((completedAt - turn.startedAt) * SECOND_MS))),
  };
}

export function turnElapsedMs(turn: Turn, now: number): number | null {
  if (turn.status !== "inProgress" && turn.durationMs != null) return Math.max(0, turn.durationMs);
  if (turn.startedAt == null) return null;
  const end = turn.status === "inProgress" ? now : (turn.completedAt == null ? null : turn.completedAt * SECOND_MS);
  return end == null ? null : Math.max(0, end - turn.startedAt * SECOND_MS);
}

export function formatTurnDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / SECOND_MS);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (!minutes) return `${seconds}秒`;
  const remainder = seconds % SECONDS_PER_MINUTE;
  if (minutes < MINUTES_PER_HOUR) return `${minutes}分${remainder}秒`;
  return `${Math.floor(minutes / MINUTES_PER_HOUR)}小时${minutes % MINUTES_PER_HOUR}分${remainder}秒`;
}
