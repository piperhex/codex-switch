import { useEffect, useState } from "react";
import { guiApi } from "./api";
import type { ListResponse, Thread } from "./types";

const SEARCH_DELAY_MS = 180;
const REFRESH_INTERVAL_MS = 5_000;
const PAGE_SIZE = 50;

/** Search independently of the sidebar's filters, with single-flight status refreshes. */
export function useConversationCandidates(options: { active: boolean; connected: boolean; query: string }) {
  const { active, connected, query } = options;
  const [result, setResult] = useState({ threads: [] as Thread[], query: "", loading: false, error: "" });
  useEffect(() => {
    if (!active || !connected) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await guiApi.request<ListResponse<Thread>>({ operation: "list", archived: false,
          search: query || undefined, limit: PAGE_SIZE });
        if (!cancelled) setResult({ threads: response.data, query, loading: false, error: "" });
      } catch {
        if (!cancelled) setResult({ threads: [], query, loading: false, error: "对话加载失败，请重新输入 @ 重试。" });
      } finally { inFlight = false; }
    };
    setResult({ threads: [], query, loading: true, error: "" });
    const timer = setTimeout(() => void refresh(), query ? SEARCH_DELAY_MS : 0);
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(interval); };
  }, [active, connected, query]);
  return result.query === query ? result : { threads: [], loading: active, error: "" };
}
