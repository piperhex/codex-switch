import { useEffect, useRef, useState } from 'react';
import type { ChatController } from './controller';
import type { Thread } from './types';

const SEARCH_DELAY_MS = 250;
interface SearchState { threads: Thread[]; cursor: string | null; loading: boolean; error: string }
const emptySearch: SearchState = { threads: [], cursor: null, loading: false, error: '' };
interface Options { controller: ChatController; query: string; archived: boolean; ready: boolean }

/** Keep search results and in-flight requests separate from the sidebar. */
export function useChatSearch({ controller, query, archived, ready }: Options) {
  const [result, setResult] = useState(emptySearch);
  const request = useRef((_more: boolean) => {});
  const search = query.trim();
  useEffect(() => {
    let disposed = false;
    let reading = false;
    let cursor: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult({ ...emptySearch, loading: ready && Boolean(search) });
    const read = async (more: boolean) => {
      if (!ready || !search || reading || (more && !cursor)) return;
      clearTimeout(timer);
      reading = true;
      setResult((previous) => ({ ...previous, loading: true, error: '' }));
      try {
        const response = await controller.searchThreads({
          search, archived, cursor: more ? cursor ?? undefined : undefined,
        });
        if (disposed) return;
        cursor = response.nextCursor;
        setResult((previous) => ({ threads: [...new Map((more
          ? [...previous.threads, ...response.data] : response.data).map((thread) => [thread.id, thread])).values()],
        cursor, loading: false, error: '' }));
      } catch {
        if (!disposed) setResult((previous) => ({ ...previous, loading: false, error: '搜索未完成，请重试。' }));
      } finally { reading = false; }
    };
    request.current = (more) => { void read(more); };
    if (ready && search) timer = setTimeout(() => { void read(false); }, SEARCH_DELAY_MS);
    return () => { disposed = true; clearTimeout(timer); request.current = () => {}; };
  }, [controller, search, archived, ready]);
  return { ...result, reload: () => request.current(false), loadMore: () => request.current(true) };
}
