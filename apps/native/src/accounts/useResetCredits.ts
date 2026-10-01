import { t } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchResetCredits } from '../api/client';
import type { AccountSummary, ResetCreditsSummary } from '../types';

export function useResetCredits(account: AccountSummary) {
  const [summary, setSummary] = useState<ResetCreditsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestAccount = useRef(account);
  latestAccount.current = account;
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const reload = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const currentGeneration = generation.current;
    setLoading(true);
    setError(null);
    const request = fetchResetCredits(latestAccount.current).then((next) => {
      if (generation.current === currentGeneration) setSummary(next);
    }).catch(() => {
      if (generation.current !== currentGeneration) return;
      setSummary(null);
      setError(t("重置卡暂时无法读取，请稍后重试"));
    }).finally(() => {
      if (generation.current === currentGeneration) setLoading(false);
      if (inFlight.current === request) inFlight.current = null;
    });
    inFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    setSummary(null);
    void reload();
    return () => {
      generation.current += 1;
      inFlight.current = null;
    };
  }, [account.id, account.accountId, account.codexAccessToken, reload]);

  return { summary, loading, error, reload };
}

export type ResetCreditsState = ReturnType<typeof useResetCredits>;
