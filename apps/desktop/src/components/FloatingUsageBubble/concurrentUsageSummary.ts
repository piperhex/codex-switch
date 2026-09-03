import type { Account, AccountTokenUsageTotals } from "../../types";

export interface ConcurrentUsageSummary {
  accountCount: number;
  estimatedCost: number;
  totalTokens: number;
}

function usageMatchesAccount(usage: AccountTokenUsageTotals, account: Account) {
  const accountId = account.accountId?.trim();
  const usageAccountId = usage.accountId?.trim();
  if (accountId && usageAccountId && accountId === usageAccountId) return true;
  const email = account.email.trim().toLowerCase();
  const usageEmail = usage.accountEmail?.trim().toLowerCase();
  return Boolean(email && usageEmail && email === usageEmail);
}

export function accountParticipatesInConcurrentRouting(account: Account, accountGroup: string | null) {
  return account.autoSwitchEnabled && (!accountGroup || account.group === accountGroup);
}

export function summarizeConcurrentUsage(
  accounts: Account[],
  usageTotals: AccountTokenUsageTotals[],
  accountGroup: string | null = null,
): ConcurrentUsageSummary {
  const enabledAccounts = accounts.filter((account) => (
    accountParticipatesInConcurrentRouting(account, accountGroup)
  ));
  return enabledAccounts.reduce<ConcurrentUsageSummary>((summary, account) => {
    const usage = usageTotals.find((item) => usageMatchesAccount(item, account));
    summary.totalTokens += usage?.totalTokens ?? 0;
    summary.estimatedCost += usage?.estimatedCost ?? 0;
    return summary;
  }, {
    accountCount: enabledAccounts.length,
    estimatedCost: 0,
    totalTokens: 0,
  });
}
