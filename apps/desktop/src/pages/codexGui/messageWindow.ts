import type { Item, Turn } from "./types";
import { groupTurnItems } from "../../../../../shared/chat/turnGroups";
import { followsStoppedTurn, visibleContinuationItems } from "./continuation";

export const MESSAGE_PAGE_SIZE = 10;
export interface MessageCursor { turnId: string; itemId: string }
interface Position { turn: number; item: number }
export interface VisibleTurn { turn: Turn; items: Item[]; followsInterruption: boolean }

function groupStarts(turns: Turn[], index: number): number[] {
  const items = turns[index].items;
  const visible = followsStoppedTurn(turns[index - 1]) ? visibleContinuationItems(items) : items;
  const starts = new Set(groupTurnItems(visible).map((group) => group.items[0].id));
  return items.flatMap((item, position) => starts.has(item.id) ? [position] : []);
}

function locate(turns: Turn[], cursor?: MessageCursor): Position | undefined {
  if (!cursor) return;
  for (let turn = turns.length - 1; turn >= 0; turn--) {
    if (turns[turn].id !== cursor.turnId) continue;
    for (let item = turns[turn].items.length - 1; item >= 0; item--) {
      if (turns[turn].items[item].id !== cursor.itemId) continue;
      // Streaming can merge the previously final message into a longer process group.
      const start = groupStarts(turns, turn).filter((position) => position <= item).at(-1);
      return start === undefined ? undefined : { turn, item: start };
    }
    return;
  }
}

function preceding(turns: Turn[], end: Position): Position | undefined {
  let remaining = MESSAGE_PAGE_SIZE;
  let first: Position | undefined;
  for (let turn = end.turn; turn >= 0; turn--) {
    const starts = groupStarts(turns, turn).filter((item) => turn !== end.turn || item < end.item);
    if (starts.length >= remaining) return { turn, item: starts[starts.length - remaining] };
    if (starts.length) first = { turn, item: starts[0] };
    remaining -= starts.length;
  }
  return first;
}

function hasEarlierItems(turns: Turn[], first: Position): boolean {
  if (groupStarts(turns, first.turn).some((item) => item < first.item)) return true;
  for (let index = 0; index < first.turn; index++) {
    if (groupStarts(turns, index).length > 0) return true;
  }
  return false;
}

/** Page visible messages and whole process groups; collapsed activities must not consume separate pages. */
export function messageWindow(turns: Turn[], options: { start?: MessageCursor; older?: boolean } = {}) {
  if (!turns.length) return { entries: [] as VisibleTurn[], start: undefined, hasMore: false };
  const previous = locate(turns, options.start);
  const end = { turn: turns.length - 1, item: turns[turns.length - 1].items.length };
  const first = previous && !options.older ? previous : preceding(turns, previous ?? end) ?? previous
    ?? { turn: 0, item: 0 };
  const entries = turns.slice(first.turn).map((turn, index) => ({ turn,
    items: index === 0 && first.item > 0 ? turn.items.slice(first.item) : turn.items,
    followsInterruption: followsStoppedTurn(turns[first.turn + index - 1]),
  }));
  const firstItem = entries.find((entry) => entry.items.length > 0);
  return { entries, hasMore: hasEarlierItems(turns, first),
    start: firstItem ? { turnId: firstItem.turn.id, itemId: firstItem.items[0].id } : undefined };
}
