import type { Account } from "../../types";
import { normalizeTotpSecret, type TotpEntry } from "../../utils/totp";

const ACCOUNT_ENTRY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export function toBoundTotpEntries(accounts: Account[]): TotpEntry[] {
  return accounts.flatMap((account) => {
    try {
      const secret = normalizeTotpSecret(account.privateDetails.totpSecret);
      return [{
        id: `account:${account.id}`,
        issuer: "ChatGPT",
        accountName: account.email,
        secret,
        algorithm: "SHA1" as const,
        digits: 6 as const,
        period: 30,
        createdAt: ACCOUNT_ENTRY_TIMESTAMP,
        updatedAt: ACCOUNT_ENTRY_TIMESTAMP,
      }];
    } catch {
      // Accounts without a valid authenticator secret do not have a code to display.
      return [];
    }
  });
}
