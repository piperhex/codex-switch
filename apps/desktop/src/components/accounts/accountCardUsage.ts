import type { Account, AccountTokenUsageTotals } from "../../types";
import { EMPTY_TOKEN_TOTALS, type TokenTypeTotals } from "../DailyTokenUsageTooltip";

export interface AccountCardTokenUsage {
  totals: TokenTypeTotals;
  estimatedCost: number;
}

const EMPTY_ACCOUNT_USAGE: AccountCardTokenUsage = { totals: EMPTY_TOKEN_TOTALS, estimatedCost: 0 };

function findUsageAccount(accounts: Account[], usage: AccountTokenUsageTotals) {
  const id = usage.accountId?.trim();
  const email = usage.accountEmail?.trim().toLowerCase();
  // Prefer the managed ID so accounts sharing an email or workspace don't steal each other's usage.
  const managed = id ? accounts.find((account) => account.id === id) : undefined;
  if (managed) return managed;
  const workspace = id ? accounts.filter((account) => account.accountId?.trim() === id) : [];
  const candidates = workspace.length ? workspace : accounts;
  return candidates.find((account) => email && account.email.trim().toLowerCase() === email)
    ?? (workspace.length === 1 ? workspace[0] : undefined);
}

export function createAccountTokenUsageLookup(accounts: Account[], entries: AccountTokenUsageTotals[]) {
  const byAccount = new Map<string, AccountCardTokenUsage>();
  for (const entry of entries) {
    const account = findUsageAccount(accounts, entry);
    if (!account) continue;
    const usage = byAccount.get(account.id) ?? { totals: { ...EMPTY_TOKEN_TOTALS }, estimatedCost: 0 };
    usage.totals.total += entry.totalTokens;
    usage.totals.input += entry.inputTokens;
    usage.totals.output += entry.outputTokens;
    usage.totals.reasoning += entry.reasoningTokens;
    usage.totals.cached += entry.cachedTokens;
    usage.estimatedCost += entry.estimatedCost;
    byAccount.set(account.id, usage);
  }
  return (account: Account) => byAccount.get(account.id) ?? EMPTY_ACCOUNT_USAGE;
}
