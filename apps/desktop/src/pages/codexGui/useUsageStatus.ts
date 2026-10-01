import { guiText } from "../../i18n/guiText";
import { useEffect, useRef, useState } from "react";
import { invoke } from "../../api/backend";
import { USAGE_REFRESH_INTERVAL_MS, type UsageSummary } from "../../../../../shared/remote-chat/usage";
export type { UsageSummary } from "../../../../../shared/remote-chat/usage";

export function useUsageStatus(active: boolean) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState("");
  const loading = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = async () => {
      if (loading.current || cancelled) return;
      loading.current = true;
      try {
        const nextUsage = await invoke<UsageSummary>("codex_gui_usage_summary");
        if (cancelled) return;
        setUsage(nextUsage);
        setError("");
      } catch {
        if (!cancelled) { setUsage(null); setError(guiText("暂时无法刷新用量，请稍后重试。")); }
      } finally { loading.current = false; }
    };
    queueMicrotask(() => void refresh());
    const timer = setInterval(() => void refresh(), USAGE_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active]);

  return { usage, error };
}
