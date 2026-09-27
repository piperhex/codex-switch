import type { RequestError } from "./requestError";
import type { Turn } from "./types";

export interface TurnRequestError {
  id: string;
  afterItemId: string | null;
  itemCount: number;
  error?: RequestError;
  willRetry: boolean;
}

function errorAtEnd(turn: Turn, error: RequestError | undefined, willRetry: boolean): TurnRequestError {
  return { id: `${turn.id}:error:${turn.requestErrors?.length ?? 0}`,
    afterItemId: turn.items.at(-1)?.id ?? null, itemCount: turn.items.length, error, willRetry };
}

/** Anchor notices when the event arrives, before subsequent items can extend the turn. */
export function recordRequestError(turn: Turn, error: RequestError, willRetry: boolean): Turn {
  const records = turn.requestErrors ?? [];
  const next = errorAtEnd(turn, error, willRetry);
  const last = records.at(-1);
  const samePosition = last && requestErrorPosition(turn, last) === next.itemCount;
  const requestErrors = samePosition
    ? [...records.slice(0, -1), { ...next, id: last.id }]
    : [...records, next];
  return { ...turn, requestErrors, ...(willRetry ? { retryError: error, error: null } : { error }) };
}

/** History and completion notifications may carry a final error without an error event. */
export function restoreRequestErrors(turn: Turn, previous?: Turn): Turn {
  const restored = { ...turn, requestErrors: turn.requestErrors ?? previous?.requestErrors };
  const last = restored.requestErrors?.at(-1);
  if (turn.error && (last?.willRetry !== false || last.error?.message !== turn.error.message
    || last.error?.additionalDetails !== turn.error.additionalDetails)) {
    return recordRequestError(restored, turn.error, false);
  }
  if (turn.status === "failed" && last?.willRetry !== false) {
    return { ...restored, requestErrors: [...(restored.requestErrors ?? []), errorAtEnd(restored, undefined, false)] };
  }
  return restored;
}

/** IDs survive history updates; the count also covers replaced local message echoes. */
export function requestErrorPosition(turn: Turn, record: TurnRequestError): number {
  if (record.afterItemId === null) return 0;
  const index = turn.items.findIndex((item) => item.id === record.afterItemId);
  return index < 0 ? Math.min(record.itemCount, turn.items.length) : index + 1;
}

export function turnRequestErrors(turn: Turn): TurnRequestError[] {
  if (turn.requestErrors?.length) return turn.requestErrors;
  const error = turn.error ?? turn.retryError;
  return error || turn.status === "failed"
    ? [errorAtEnd(turn, error, !turn.error && turn.status !== "failed")] : [];
}
