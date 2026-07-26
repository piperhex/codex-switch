import type { Language } from "../i18n";
import type { Account, TokenUsageEntry } from "../types";

export interface TokenContextUsage {
  availableTokens: number;
  totalTokens: number;
}

function entryMatchesAccount(entry: TokenUsageEntry, account: Account) {
  const accountId = account.accountId?.trim();
  const entryAccountId = entry.accountId?.trim();
  if (accountId && entryAccountId && accountId === entryAccountId) return true;

  const email = account.email.trim().toLowerCase();
  const entryEmail = entry.accountEmail?.trim().toLowerCase();
  return Boolean(email && entryEmail && email === entryEmail);
}

export function latestTokenContextForAccount(
  entries: TokenUsageEntry[],
  account: Account,
  model?: string,
): TokenContextUsage | null {
  const entry = entries.find((candidate) => (
    (!model || candidate.model === model) && entryMatchesAccount(candidate, account)
  ));
  const totalTokens = entry?.modelContextWindow;
  if (!entry || !totalTokens || totalTokens <= 0) return null;

  const usedTokens = entry.totalTokens
    ?? (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
  return {
    availableTokens: Math.max(0, totalTokens - usedTokens),
    totalTokens,
  };
}

export function formatCompactTokenCount(value: number, language: Language) {
  const locale = language === "zh" ? "zh-CN" : "en-US";
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
  }
  return new Intl.NumberFormat(locale).format(value);
}
