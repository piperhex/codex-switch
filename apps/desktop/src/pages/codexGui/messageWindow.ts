import type { Item, Turn } from "./types";

export const MESSAGE_PAGE_SIZE = 10;
export interface MessageCursor { turnId: string; itemId: string }
interface Position { turn: number; item: number }
export interface VisibleTurn { turn: Turn; items: Item[]; followsInterruption: boolean }

function locate(turns: Turn[], cursor?: MessageCursor): Position | undefined {
  if (!cursor) return;
  for (let turn = turns.length - 1; turn >= 0; turn--) {
    if (turns[turn].id !== cursor.turnId) continue;
    for (let item = turns[turn].items.length - 1; item >= 0; item--) {
      if (turns[turn].items[item].id === cursor.itemId) return { turn, item };
    }
    return;
  }
}

function preceding(turns: Turn[], end: Position): Position {
  let remaining = MESSAGE_PAGE_SIZE;
  for (let turn = end.turn; turn >= 0; turn--) {
    const count = turn === end.turn ? end.item : turns[turn].items.length;
    if (count >= remaining) return { turn, item: count - remaining };
    remaining -= count;
  }
  return { turn: 0, item: 0 };
}

function hasEarlierItems(turns: Turn[], first: Position): boolean {
  if (first.item > 0) return true;
  for (let index = 0; index < first.turn; index++) {
    if (turns[index].items.length > 0) return true;
  }
  return false;
}

/** Keep full turns for actions and grouping, but only mount the selected suffix of their items. */
export function messageWindow(turns: Turn[], options: { start?: MessageCursor; older?: boolean } = {}) {
  if (!turns.length) return { entries: [] as VisibleTurn[], start: undefined, hasMore: false };
  const previous = locate(turns, options.start);
  const end = { turn: turns.length - 1, item: turns[turns.length - 1].items.length };
  const first = previous && !options.older ? previous : preceding(turns, previous ?? end);
  const entries = turns.slice(first.turn).map((turn, index) => ({ turn,
    items: index === 0 && first.item > 0 ? turn.items.slice(first.item) : turn.items,
    followsInterruption: turns[first.turn + index - 1]?.status === "interrupted",
  }));
  const firstItem = entries.find((entry) => entry.items.length > 0);
  return { entries, hasMore: hasEarlierItems(turns, first),
    start: firstItem ? { turnId: firstItem.turn.id, itemId: firstItem.items[0].id } : undefined };
}
