import { describe, expect, it } from "vitest";
import type { Account, AccountTokenUsageTotals } from "../../types";
import { summarizeConcurrentUsage } from "./concurrentUsageSummary";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    email: "one@example.com",
    note: "",
    expiresAt: "",
    privateDetails: { password: "", phoneNumber: "", totpSecret: "" },
    plan: "Plus",
    accountId: "workspace-1",
    active: true,
    autoSwitchEnabled: true,
    autoSwitchPriority: 0,
    autoSwitchThreshold: 0,
    localProxyCompatible: true,
    directSwitchCompatible: true,
    agentIdentity: false,
    official: true,
    metadataEditable: true,
    usage: {},
    ...overrides,
  };
}

function usage(overrides: Partial<AccountTokenUsageTotals> = {}): AccountTokenUsageTotals {
  return {
    accountId: "workspace-1",
    accountEmail: "one@example.com",
    totalTokens: 12_000,
    inputTokens: 10_000,
    outputTokens: 2_000,
    reasoningTokens: 500,
    cachedTokens: 4_000,
    estimatedCost: 0.08,
    ...overrides,
  };
}

describe("summarizeConcurrentUsage", () => {
  it("totals only accounts enabled for concurrent routing", () => {
    const accounts = [
      account(),
      account({
        id: "account-2",
        email: "two@example.com",
        accountId: "workspace-2",
        autoSwitchEnabled: false,
      }),
    ];
    const totals = [usage(), usage({
      accountId: "workspace-2",
      accountEmail: "two@example.com",
      totalTokens: 99_000,
      estimatedCost: 2.5,
    })];

    expect(summarizeConcurrentUsage(accounts, totals)).toEqual({
      accountCount: 1,
      totalTokens: 12_000,
      estimatedCost: 0.08,
    });
  });

  it("matches usage by normalized email when an account id is unavailable", () => {
    const accounts = [account({ accountId: null, email: " User@Example.com " })];
    const totals = [usage({ accountId: null, accountEmail: "user@example.com" })];

    expect(summarizeConcurrentUsage(accounts, totals).totalTokens).toBe(12_000);
  });
});
