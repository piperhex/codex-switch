import { sliceHistory, type HistoryPage } from '../historyPage';
import type { Thread } from './types';

const HISTORY_CACHE_LIMITS = { entries: 8, chars: 4 * 1024 * 1024 };
interface CachedHistory { thread: Thread; page: HistoryPage; chars: number }

// Estimate retained content without allocating a serialized copy of large outputs or image data.
function retainedChars(value: unknown, limit: number): number {
  if (typeof value === 'string') return value.length;
  if (!value || typeof value !== 'object') return 1;
  let chars = 1;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    chars += key.length + retainedChars((value as Record<string, unknown>)[key], limit - chars);
    if (chars > limit) break;
  }
  return chars;
}

/** Reopen at the latest page; older messages remain available from the PC through the saved cursor. */
export class HistoryCache {
  private readonly entries = new Map<string, CachedHistory>();
  private chars = 0;
  constructor(private readonly limits = HISTORY_CACHE_LIMITS) {}

  get(id: string) {
    const cached = this.entries.get(id);
    if (cached) { this.entries.delete(id); this.entries.set(id, cached); }
    return cached;
  }

  has(id: string) { return this.entries.has(id); }

  remember(thread: Thread, page?: HistoryPage) {
    const recent = sliceHistory(thread);
    const chars = retainedChars(recent.thread, this.limits.chars);
    this.remove(thread.id);
    if (chars > this.limits.chars) return;
    this.entries.set(thread.id, { ...recent, chars,
      page: { ...recent.page, hasMore: recent.page.hasMore || Boolean(page?.hasMore) } });
    this.chars += chars;
    for (const id of this.entries.keys()) {
      if (this.entries.size <= this.limits.entries && this.chars <= this.limits.chars) break;
      this.remove(id);
    }
  }

  remove(id: string) {
    const previous = this.entries.get(id);
    if (previous) this.chars -= previous.chars;
    this.entries.delete(id);
  }
}
