export interface DailyTokenUsageBreakdown {
  date: string;
  shortContextTokens: number;
  longContextTokens: number;
  unknownContextTokens: number;
  standardModeTokens: number;
  fastModeTokens: number;
  unknownModeTokens: number;
}

export interface AccountQuotaPoint {
  ts: number;
  primaryRemainingPercent: number | null;
  secondaryRemainingPercent: number | null;
  primaryResetAt: number | null;
  secondaryResetAt: number | null;
}

export interface AccountQuotaHistory {
  accountId: string;
  accountLabel: string;
  points: AccountQuotaPoint[];
}
