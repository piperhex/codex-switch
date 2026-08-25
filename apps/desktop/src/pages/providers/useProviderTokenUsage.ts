import { useEffect, useMemo, useState } from "react";
import { loadProviderTokenUsage, subscribeToTokenUsageChanges } from "../../api/backend";
import type { Provider, ProviderTokenUsageTotals } from "../../types";
import { createProviderTokenUsageLookup } from "../../utils/providerTokenUsage";
import { TOKEN_COST_CUSTOM_RULES_EVENT } from "../../utils/tokenCost";

export function useProviderTokenUsage(tokenUsageRefreshSeconds: number, providers: Provider[]) {
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
        const totals = await loadProviderTokenUsage(startTs, providers);
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
    window.addEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refresh);
    };
  }, [providers, tokenUsageRefreshSeconds]);

  return useMemo(
    () => createProviderTokenUsageLookup(providerTokenUsage),
    [providerTokenUsage],
  );
}
