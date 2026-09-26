import { useEffect, useRef, useState } from "react";
import { invoke, isHostedWebApp, canManageCodexConnection } from "../../api/backend";
import type { GuiRequestSettings } from "./requestSpeedBridge";
import { USAGE_REFRESH_INTERVAL_MS, type UsageSummary } from "../../../../../shared/remote-chat/usage";
export type { UsageSummary } from "../../../../../shared/remote-chat/usage";

const CAN_CHANGE_FAST_MODE = !isHostedWebApp || canManageCodexConnection;

export function useUsageStatus(active: boolean) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [proxy, setProxy] = useState<GuiRequestSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loading = useRef(false);
  const changing = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = async () => {
      if (loading.current || changing.current || cancelled) return;
      loading.current = true;
      const startedAtRevision = revision.current;
      try {
        const [nextUsage, nextProxy] = await Promise.allSettled([
          invoke<UsageSummary>("codex_gui_usage_summary"),
          invoke<GuiRequestSettings>("codex_gui_request_settings"),
        ]);
        if (cancelled) return;
        setUsage(nextUsage.status === "fulfilled" ? nextUsage.value : null);
        // A poll started before a speed change must not restore the old switch position.
        if (startedAtRevision === revision.current && nextProxy.status === "fulfilled") setProxy(nextProxy.value);
        setError(nextUsage.status === "rejected" || nextProxy.status === "rejected"
          ? "暂时无法刷新用量，请稍后重试。" : "");
      } catch {
        if (!cancelled) { setUsage(null); setError("暂时无法刷新用量，请稍后重试。"); }
      } finally { loading.current = false; }
    };
    queueMicrotask(() => void refresh());
    const timer = setInterval(() => void refresh(), USAGE_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active]);

  const setFastMode = async (enabled: boolean) => {
    if (!CAN_CHANGE_FAST_MODE || changing.current || !proxy || (enabled && !proxy.fastModeAvailable)) return;
    changing.current = true;
    revision.current += 1;
    setSaving(true);
    try {
      const result = await invoke<GuiRequestSettings>("codex_gui_set_fast_mode", { enabled });
      if (mounted.current) { setProxy(result); setError(""); }
    } catch {
      if (mounted.current) setError("快速模式未能切换，请稍后重试。");
    } finally {
      changing.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return { usage, proxy, saving, error, setFastMode, canChangeFastMode: CAN_CHANGE_FAST_MODE };
}
