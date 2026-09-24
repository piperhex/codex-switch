import { applyHistoryDelta, HistoryVersionCache, type HistoryVersion } from '../historySync';
import { sliceHistory, type HistoryWindow, type PagedHistoryDelta } from '../historyPage';
import type { Thread } from './types';
import type { HistoryVersionSource } from './historyPreparation';

type HistoryRequest = { operation: 'read'; threadId: string }
  | { operation: 'syncHistory'; threadId: string; known: HistoryVersion; window: HistoryWindow };
const UNSUPPORTED_OPERATION = '当前手机端暂不支持此操作。';

/** Older PCs expose read but do not recognize incremental history or its paging window. */
export class HistoryReader {
  private legacy = false;
  private generation = 0;
  constructor(private readonly request: <T>(body: HistoryRequest) => Promise<T>,
    private readonly versions: HistoryVersionSource = new HistoryVersionCache()) {}

  reset() { this.legacy = false; this.generation++; }

  async read(selected: Thread, window: HistoryWindow) {
    const generation = this.generation;
    if (!this.legacy) {
      try {
        const preparation = this.versions.read(selected);
        const known = preparation instanceof Promise ? await preparation : preparation;
        if (generation !== this.generation) throw new Error('聊天连接已更新，请重试。');
        const result = await this.request<PagedHistoryDelta>({ operation: 'syncHistory', threadId: selected.id,
          known, window });
        const thread = applyHistoryDelta(selected, result);
        return result.page ? { thread, page: result.page } : sliceHistory(thread, window);
      } catch (error) {
        const message = error instanceof Error ? error.message : error;
        if (message !== UNSUPPORTED_OPERATION || generation !== this.generation) throw error;
        this.legacy = true;
      }
    }
    const { thread } = await this.request<{ thread: Thread }>({ operation: 'read', threadId: selected.id });
    if (thread?.id !== selected.id) throw new Error('聊天已切换，请重新打开。');
    return sliceHistory(thread, window);
  }
}
