import type { Item, Thread, Turn } from './types';
import { restoreTurnTiming } from '../../../apps/desktop/src/pages/codexGui/turnTiming';

function mergeItem(snapshot: Item, live: Item, before?: Item): Item {
  const merged = { ...snapshot, ...live };
  for (const field of ['text', 'aggregatedOutput'] as const) {
    const readValue = snapshot[field];
    const liveValue = live[field];
    const includesUnloadedTail = !before && liveValue && readValue?.includes(liveValue);
    if (readValue && (!liveValue || readValue.startsWith(liveValue) || includesUnloadedTail)) merged[field] = readValue;
  }
  return merged;
}

function mergeTurn(snapshot: Turn, live: Turn, before?: Turn): Turn {
  const original = new Map(before?.items.map((item) => [item.id, item]));
  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  for (const item of live.items) {
    if (item === original.get(item.id) && live.status !== 'inProgress') continue;
    const existing = items.get(item.id);
    items.set(item.id, existing ? mergeItem(existing, item, original.get(item.id)) : item);
  }
  const terminal = live.status !== 'inProgress' ? live.status : snapshot.status;
  return { ...snapshot, ...live, status: terminal, items: [...items.values()] };
}

/** Preserve notifications received while a history snapshot was in flight. */
export function mergeHistory(snapshot: Thread, live: Thread, before: Thread): Thread {
  if (snapshot.id !== live.id) return snapshot;
  const original = new Map(before.turns?.map((turn) => [turn.id, turn]));
  const turns = new Map(snapshot.turns?.map((turn) => [turn.id, turn]));
  for (const turn of live.turns ?? []) {
    if (turn === original.get(turn.id) && turn.status !== 'inProgress') continue;
    const existing = turns.get(turn.id);
    turns.set(turn.id, existing ? mergeTurn(existing, turn, original.get(turn.id)) : turn);
  }
  const previous = new Map(live.turns?.map((turn) => [turn.id, turn]));
  return { ...snapshot, turns: [...turns.values()].map((turn) => turn.status === 'inProgress'
    ? restoreTurnTiming(turn, previous.get(turn.id)) : turn) };
}
