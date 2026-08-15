import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadProviderTokenUsage,
  queryProviderBalance,
  subscribeToProviderBalance,
  subscribeToTokenUsageChanges,
} from "../api/backend";
import type { Provider, ProviderBalance, ProviderTokenUsageTotals } from "../types";
import { findProviderTokenUsage } from "../utils/providerTokenUsage";

interface ProviderStats {
  balance: ProviderBalance | null;
  balanceError: boolean;
  tokenUsage?: ProviderTokenUsageTotals;
}

function todayStartTimestamp() {
  const today = new Date();
  return Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1_000);
}

async function loadTokenUsage(provider: Provider) {
  const totals = await loadProviderTokenUsage(todayStartTimestamp());
  return findProviderTokenUsage(provider, totals) ?? {
    provider: provider.name,
    providerId: provider.id,
    todayTokens: 0,
    totalTokens: 0,
  };
}

export function useFloatingProviderStats(provider: Provider | null) {
  const providerRef = useRef(provider);
  const refreshingProviderId = useRef<string | null>(null);
  const [stats, setStats] = useState<ProviderStats>({ balance: null, balanceError: false });
  const [loading, setLoading] = useState(false);
  providerRef.current = provider;

  const refresh = useCallback(async () => {
    const current = providerRef.current;
    if (!current || refreshingProviderId.current === current.id) return;
    refreshingProviderId.current = current.id;
    setLoading(true);
    const balanceRequest = current.balancePlatform
      ? queryProviderBalance(current.id)
      : Promise.resolve(null);
    const [balanceResult, tokenResult] = await Promise.allSettled([
      balanceRequest,
      loadTokenUsage(current),
    ]);
    if (providerRef.current?.id === current.id) {
      setStats({
        balance: balanceResult.status === "fulfilled" ? balanceResult.value : null,
        balanceError: balanceResult.status === "rejected",
        tokenUsage: tokenResult.status === "fulfilled" ? tokenResult.value : undefined,
      });
      setLoading(false);
    }
    if (refreshingProviderId.current === current.id) refreshingProviderId.current = null;
  }, []);

  useEffect(() => {
    refreshingProviderId.current = null;
    setStats({ balance: null, balanceError: false });
    setLoading(false);
    if (!provider) return;
    void refresh();
    const unsubscribeBalance = subscribeToProviderBalance(provider.id, (balance) => {
      setStats((current) => ({ ...current, balance, balanceError: false }));
    });
    const unsubscribeTokens = subscribeToTokenUsageChanges(() => {
      void loadTokenUsage(provider).then((tokenUsage) => {
        if (providerRef.current?.id === provider.id) {
          setStats((current) => ({ ...current, tokenUsage }));
        }
      }).catch(() => undefined);
    });
    return () => {
      unsubscribeBalance();
      unsubscribeTokens();
    };
  }, [provider, refresh]);

  return { ...stats, loading, refresh };
}
