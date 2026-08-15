import type { TotpEntry } from "../../utils/totp";

export interface TotpIssuerOption {
  label: string;
  value: string;
}

interface TotpFilterCriteria {
  accountQuery: string;
  issuer: string;
}

function normalizedFilterValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function buildTotpIssuerOptions(entries: TotpEntry[]): TotpIssuerOption[] {
  const uniqueIssuers = new Map<string, string>();
  for (const entry of entries) {
    const label = entry.issuer.trim();
    const value = normalizedFilterValue(label);
    if (value && !uniqueIssuers.has(value)) uniqueIssuers.set(value, label);
  }
  return Array.from(uniqueIssuers, ([value, label]) => ({ label, value }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function filterTotpEntries(entries: TotpEntry[], criteria: TotpFilterCriteria) {
  const accountQuery = normalizedFilterValue(criteria.accountQuery);
  return entries.filter((entry) => (
    (!accountQuery || normalizedFilterValue(entry.accountName).includes(accountQuery))
    && (!criteria.issuer || normalizedFilterValue(entry.issuer) === criteria.issuer)
  ));
}
