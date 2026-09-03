import type { Account } from "../../types";

export interface ConcurrentAccountEligibilityOptions {
  accountGroup: string | null;
  minimumPrimaryRemaining: number | null;
}

function reportedQuotaWindowsHaveRemaining(account: Account) {
  const { primary, secondary } = account.usage;
  return (!primary || primary.remainingPercent > 0)
    && (!secondary || secondary.remainingPercent > 0);
}

export function canReceiveConcurrentConversation(
  account: Account,
  options: ConcurrentAccountEligibilityOptions,
) {
  if (!account.autoSwitchEnabled || (options.accountGroup && account.group !== options.accountGroup)) {
    return false;
  }
  if (!reportedQuotaWindowsHaveRemaining(account)) return false;
  if (options.minimumPrimaryRemaining === null) return true;
  return !account.usage.error
    && typeof account.usage.primary?.remainingPercent === "number"
    && account.usage.primary.remainingPercent >= options.minimumPrimaryRemaining;
}
