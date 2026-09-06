import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadAccountQuotaHistory, loadDailyTokenUsage, loadTokenUsageBreakdown, loadTokenUsageEntries,
} from "../../api/backend";
import type { DailyTokenUsage, TokenUsageEntry } from "../../types";
import type { AccountQuotaHistory, DailyTokenUsageBreakdown } from "../../types/tokenUsageAnalytics";
import { startOfCalendar } from "./chartUtils";
import { createDashboardLoader } from "./dashboardLoader";

interface DashboardData {
  entries: TokenUsageEntry[];
  dailyUsage: DailyTokenUsage[];
  breakdown: DailyTokenUsageBreakdown[];
  quotaHistory: AccountQuotaHistory[];
  error: boolean;
  analyticsError: boolean;
  quotaError: boolean;
  updatedAt: Date | null;
  startTs: number;
  endTs: number;
}

interface DashboardOptions { weeks: number; refreshSeconds: number; thresholdTokens: number }

export function useDashboardData({ weeks, refreshSeconds, thresholdTokens }: DashboardOptions) {
  const [data, setData] = useState<DashboardData>({
    entries: [], dailyUsage: [], breakdown: [], quotaHistory: [],
    error: false, analyticsError: false, quotaError: false, updatedAt: null,
    startTs: Math.floor(startOfCalendar(weeks).getTime() / 1000), endTs: Math.floor(Date.now() / 1000),
  });
  const [loading, setLoading] = useState(true);
  const scheduler = useRef(createDashboardLoader());
  const reload = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    const task = async () => {
      if (!active) return;
      setLoading(true);
      const startTs = Math.floor(startOfCalendar(weeks).getTime() / 1000);
      const endTs = Math.floor(Date.now() / 1000);
      const [entries, daily, breakdown, quota] = await Promise.allSettled([
        loadTokenUsageEntries(), loadDailyTokenUsage(startTs),
        loadTokenUsageBreakdown(startTs, thresholdTokens), loadAccountQuotaHistory(startTs, endTs),
      ]);
      if (!active) return;
      setData({
        entries: entries.status === "fulfilled" ? entries.value : [],
        dailyUsage: daily.status === "fulfilled" ? daily.value : [],
        breakdown: breakdown.status === "fulfilled" ? breakdown.value : [],
        quotaHistory: quota.status === "fulfilled" ? quota.value : [],
        error: entries.status === "rejected" || daily.status === "rejected",
        analyticsError: breakdown.status === "rejected", quotaError: quota.status === "rejected",
        updatedAt: new Date(), startTs, endTs,
      });
      setLoading(false);
    };
    // Clear the previous scope immediately so it cannot be shown under a new range or threshold.
    setData((current) => ({ ...current, dailyUsage: [], breakdown: [], quotaHistory: [],
      startTs: Math.floor(startOfCalendar(weeks).getTime() / 1000), endTs: Math.floor(Date.now() / 1000) }));
    setLoading(true);
    reload.current = () => { void scheduler.current(task); };
    void scheduler.current(task, true);
    const timer = window.setInterval(() => void scheduler.current(task), refreshSeconds * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [weeks, refreshSeconds, thresholdTokens]);

  const load = useCallback(() => reload.current(), []);
  return { ...data, loading, load };
}
