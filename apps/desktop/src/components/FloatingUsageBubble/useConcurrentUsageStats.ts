import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadAccountTokenUsage,
  subscribeToTokenUsageChanges,
} from "../../api/backend";
import type { Account, AccountTokenUsageTotals, Provider } from "../../types";
import {
  loadTokenCostDisplaySettings,
  TOKEN_COST_CUSTOM_RULES_EVENT,
  TOKEN_COST_DISPLAY_EVENT,
} from "../../utils/tokenCost";
import { summarizeConcurrentUsage } from "./concurrentUsageSummary";
import { TOKEN_COST_REFERENCE_MODEL_EVENT } from "../../utils/tokenCostPresets";

const STATS_REFRESH_INTERVAL_MS = 60_000;

function todayStartTimestamp() {
  const today = new Date();
  return Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1_000);
}

export function useConcurrentUsageStats(
  enabled: boolean,
  accounts: Account[],
  providers: Provider[],
  accountGroup: string | null,
) {
  const [totals, setTotals] = useState<AccountTokenUsageTotals[]>([]);
  const [display, setDisplay] = useState(loadTokenCostDisplaySettings);
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      setTotals(await loadAccountTokenUsage(todayStartTimestamp(), providers));
    } finally {
      refreshingRef.current = false;
    }
  }, [enabled, providers]);

  useEffect(() => {
    if (!enabled) {
      setTotals([]);
      return undefined;
    }
    const refreshCosts = () => void refresh().catch(() => undefined);
    const refreshDisplay = () => setDisplay(loadTokenCostDisplaySettings());
    refreshCosts();
    const timer = window.setInterval(refreshCosts, STATS_REFRESH_INTERVAL_MS);
    const unsubscribe = subscribeToTokenUsageChanges(refreshCosts);
    window.addEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refreshCosts);
    window.addEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, refreshCosts);
    window.addEventListener(TOKEN_COST_DISPLAY_EVENT, refreshDisplay);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener(TOKEN_COST_CUSTOM_RULES_EVENT, refreshCosts);
      window.removeEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, refreshCosts);
      window.removeEventListener(TOKEN_COST_DISPLAY_EVENT, refreshDisplay);
    };
  }, [enabled, refresh]);

  return {
    display,
    refresh,
    summary: summarizeConcurrentUsage(accounts, totals, accountGroup),
  };
}
