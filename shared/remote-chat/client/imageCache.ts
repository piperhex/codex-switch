import { contentHash } from '../historySync';

type ImageRequest = { operation: 'imagePreview' | 'imageChunk'; threadId: string; source: string; offset?: number };
interface ImageChunk { data: string; total: number; hash: string }
const CACHE_CHARS = 32 * 1024 * 1024;
const MAX_ORIGINAL_CHARS = 28 * 1024 * 1024;

export class ImageCache {
  private readonly cached = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  constructor(private readonly request: <T>(body: ImageRequest) => Promise<T>) {}

  load = (threadId: string, source: string, original = false): Promise<string> => {
    const key = JSON.stringify([threadId, source, original]);
    const cached = this.cached.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = (original ? this.original(threadId, source)
      : this.request<{ url: string }>({ operation: 'imagePreview', threadId, source }).then(({ url }) => url))
      .then((url) => { this.remember(key, url); return url; }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  };

  private remember(key: string, url: string) {
    this.cached.set(key, url);
    let size = [...this.cached.values()].reduce((total, value) => total + value.length, 0);
    for (const [oldKey, value] of this.cached) {
      if (size <= CACHE_CHARS) break;
      this.cached.delete(oldKey);
      size -= value.length;
    }
  }

  private async original(threadId: string, source: string) {
    let url = '';
    let total = 1;
    let hash = '';
    while (url.length < total) {
      const chunk = await this.request<ImageChunk>({ operation: 'imageChunk', threadId, source, offset: url.length });
      if (!Number.isSafeInteger(chunk.total) || chunk.total <= 0 || chunk.total > MAX_ORIGINAL_CHARS
        || !chunk.data || (hash && (chunk.hash !== hash || chunk.total !== total))) {
        throw new Error('原图加载中断，请重试。');
      }
      total = chunk.total;
      hash = chunk.hash;
      url += chunk.data;
    }
    if (url.length !== total || contentHash(url) !== hash) throw new Error('原图加载中断，请重试。');
    return url;
  }
}
