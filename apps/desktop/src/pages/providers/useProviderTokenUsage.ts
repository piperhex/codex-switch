import { useEffect, useMemo, useState } from "react";
import { loadProviderTokenUsage, subscribeToTokenUsageChanges } from "../../api/backend";
import type { ProviderTokenUsageTotals } from "../../types";
import { createProviderTokenUsageLookup } from "../../utils/providerTokenUsage";

export function useProviderTokenUsage(tokenUsageRefreshSeconds: number) {
  const [providerTokenUsage, setProviderTokenUsage] = useState<ProviderTokenUsageTotals[]>([]);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const today = new Date();
      const startTs = Math.floor(new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ).getTime() / 1_000);
      try {
        const totals = await loadProviderTokenUsage(startTs);
        if (active) setProviderTokenUsage(totals);
      } catch {
        // Keep the last successful values when token statistics are temporarily unavailable.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const refreshInterval = Math.max(1, tokenUsageRefreshSeconds) * 1_000;
    const timer = window.setInterval(() => void refresh(), refreshInterval);
    const unsubscribe = subscribeToTokenUsageChanges(() => void refresh());
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [tokenUsageRefreshSeconds]);

  return useMemo(
    () => createProviderTokenUsageLookup(providerTokenUsage),
    [providerTokenUsage],
  );
}
