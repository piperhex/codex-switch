import type { AccountSummary } from '../types';

export function mergeServerAccounts(
  currentAccounts: readonly AccountSummary[],
  serverAccounts: readonly AccountSummary[],
): AccountSummary[] {
  const currentById = new Map(currentAccounts.map((account) => [account.id, account]));
  return serverAccounts.map((serverAccount) => {
    const current = currentById.get(serverAccount.id);
    return current ? { ...serverAccount, usage: current.usage } : serverAccount;
  });
}

export function mergeRefreshedUsage(
  currentAccounts: readonly AccountSummary[],
  refreshedAccounts: readonly AccountSummary[],
): AccountSummary[] {
  const refreshedById = new Map(refreshedAccounts.map((account) => [account.id, account]));
  return currentAccounts.map((current) => {
    const refreshed = refreshedById.get(current.id);
    return refreshed
      ? { ...current, plan: refreshed.plan, usage: refreshed.usage }
      : current;
  });
}
