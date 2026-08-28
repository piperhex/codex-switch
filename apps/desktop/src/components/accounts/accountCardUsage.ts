import type { Account, AccountTokenUsageTotals } from "../../types";
import type { TokenTypeTotals } from "../DailyTokenUsageTooltip";

export interface AccountCardTokenUsage {
  totals: TokenTypeTotals;
  estimatedCost: number;
}

function tokenUsageMatchesAccount(usage: AccountTokenUsageTotals, account: Account) {
  const accountId = account.accountId?.trim();
  const usageAccountId = usage.accountId?.trim();
  if (accountId && usageAccountId && accountId === usageAccountId) return true;
  const email = account.email.trim().toLowerCase();
  const usageEmail = usage.accountEmail?.trim().toLowerCase();
  return Boolean(email && usageEmail && email === usageEmail);
}

export function getAccountCardTokenUsage(
  account: Account,
  totalsByAccount: Map<string, TokenTypeTotals>,
  accountTokenUsage: AccountTokenUsageTotals[],
): AccountCardTokenUsage {
  const usage = accountTokenUsage.find((item) => tokenUsageMatchesAccount(item, account));
  return {
    totals: totalsByAccount.get(account.id) ?? {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cached: 0,
    },
    estimatedCost: usage?.estimatedCost ?? 0,
  };
}
