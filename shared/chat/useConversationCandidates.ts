import { useEffect, useState } from 'react';
import type { ListResponse, Thread } from '../remote-chat/client/types';

const SEARCH_DELAY_MS = 180;
const REFRESH_INTERVAL_MS = 5_000;
const PAGE_SIZE = 50;

export type ConversationSearch = (options: {
  search: string; archived: boolean; limit: number;
}) => Promise<ListResponse<Thread>>;

/** Search independently of sidebar filters and discard results when the source or query changes. */
export function useConversationCandidates(options: {
  active: boolean; connected: boolean; query: string; load: ConversationSearch;
}) {
  const { active, connected, query, load } = options;
  const [result, setResult] = useState({ threads: [] as Thread[], query: '', loading: false, error: '' });
  useEffect(() => {
    if (!active || !connected) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await load({ archived: false, search: query, limit: PAGE_SIZE });
        if (!cancelled) setResult({ threads: response.data, query, loading: false, error: '' });
      } catch {
        if (!cancelled) setResult({ threads: [], query, loading: false, error: '对话加载失败，请重新输入 @ 重试。' });
      } finally { inFlight = false; }
    };
    setResult({ threads: [], query, loading: true, error: '' });
    const timer = setTimeout(() => void refresh(), query ? SEARCH_DELAY_MS : 0);
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(interval); };
  }, [active, connected, query, load]);
  return result.query === query ? result : { threads: [], loading: active, error: '' };
}
