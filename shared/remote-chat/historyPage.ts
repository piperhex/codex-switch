import type { Thread } from './client/types';
import type { HistoryDelta } from './historySync';

export const HISTORY_PAGE_SIZE = 10;
export interface HistoryCursor { turnId: string; itemId: string }
export interface HistoryWindow { start?: HistoryCursor; older?: boolean }
export interface HistoryPage { start?: HistoryCursor; hasMore: boolean }
export type PagedHistoryDelta = HistoryDelta & { page?: HistoryPage };

function validCursor(value: unknown): value is HistoryCursor {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as Partial<HistoryCursor>;
  return [cursor.turnId, cursor.itemId].every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256);
}

export function parseHistoryWindow(value: unknown): HistoryWindow {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object') throw new Error('聊天记录已更新，请重新打开聊天。');
  const window = value as HistoryWindow;
  if ((window.start !== undefined && !validCursor(window.start))
    || (window.older !== undefined && typeof window.older !== 'boolean')) {
    throw new Error('聊天记录已更新，请重新打开聊天。');
  }
  return window;
}

/** The cursor names an item, so new replies cannot shift the older-message boundary. */
export function sliceHistory(thread: Thread, window: HistoryWindow = {}): { thread: Thread; page: HistoryPage } {
  const turns = thread.turns ?? [];
  let count = 0;
  let anchor = -1;
  for (const turn of turns) {
    const index = turn.id === window.start?.turnId
      ? turn.items.findIndex((item) => item.id === window.start?.itemId) : -1;
    if (index >= 0) anchor = count + index;
    count += turn.items.length;
  }
  const start = anchor < 0 ? Math.max(0, count - HISTORY_PAGE_SIZE)
    : Math.max(0, anchor - (window.older ? HISTORY_PAGE_SIZE : 0));
  let offset = 0;
  const selected = turns.flatMap((turn) => {
    const from = Math.max(0, start - offset);
    offset += turn.items.length;
    // Keep the empty active turn so processing status is visible before its first item arrives.
    return offset > start || (offset === count && turn.status === 'inProgress')
      ? [{ ...turn, items: turn.items.slice(from) }] : [];
  });
  const first = selected.find((turn) => turn.items.length > 0);
  return { thread: { ...thread, turns: selected }, page: { hasMore: start > 0,
    start: first ? { turnId: first.id, itemId: first.items[0].id } : undefined } };
}
