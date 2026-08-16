import { describe, expect, it } from "vitest";
import type { TotpEntry } from "../../utils/totp";
import { buildTotpIssuerOptions, filterTotpEntries } from "./filter";

function entry(id: string, issuer: string, accountName: string): TotpEntry {
  return {
    id,
    issuer,
    accountName,
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  };
}

const entries = [
  entry("1", "GitHub", "alice@example.com"),
  entry("2", " github ", "bob@example.com"),
  entry("3", "GitLab", "Alice.Work"),
];

describe("2FA filters", () => {
  it("deduplicates service names without losing the original display name", () => {
    expect(buildTotpIssuerOptions(entries)).toEqual([
      { label: "GitHub", value: "github" },
      { label: "GitLab", value: "gitlab" },
    ]);
  });

  it("searches accounts case-insensitively and combines the service filter", () => {
    expect(filterTotpEntries(entries, { accountQuery: "ALICE", issuer: "gitlab" }))
      .toEqual([entries[2]]);
    expect(filterTotpEntries(entries, { accountQuery: "example", issuer: "github" }))
      .toEqual([entries[0], entries[1]]);
  });
});
