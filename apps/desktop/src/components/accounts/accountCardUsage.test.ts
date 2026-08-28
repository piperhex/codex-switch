import { describe, expect, it } from "vitest";
import type { Account, AccountTokenUsageTotals } from "../../types";
import { EMPTY_TOKEN_TOTALS, type TokenTypeTotals } from "../DailyTokenUsageTooltip";
import { getOfficialAccountCardTokenUsage } from "./accountCardUsage";

function account(official: boolean): Account {
  return {
    id: "account-1",
    email: "official@example.com",
    note: "",
    expiresAt: "",
    privateDetails: { password: "", phoneNumber: "", totpSecret: "" },
    plan: "Plus",
    active: false,
    autoSwitchEnabled: true,
    autoSwitchPriority: 0,
    autoSwitchThreshold: 0,
    localProxyCompatible: true,
    directSwitchCompatible: true,
    agentIdentity: false,
    official,
    metadataEditable: false,
    usage: {},
  };
}

describe("official account card token usage", () => {
  it("returns today's token totals and estimated cost for official accounts", () => {
    const totals: TokenTypeTotals = { total: 1200, input: 800, output: 300, reasoning: 50, cached: 50 };
    const usage: AccountTokenUsageTotals[] = [{
      accountId: "account-1",
      accountEmail: "official@example.com",
      totalTokens: 1200,
      inputTokens: 800,
      outputTokens: 300,
      reasoningTokens: 50,
      cachedTokens: 50,
      estimatedCost: 0.0123,
    }];

    expect(getOfficialAccountCardTokenUsage(account(true), new Map([["account-1", totals]]), usage))
      .toEqual({ totals, estimatedCost: 0.0123 });
  });

  it("does not return token footer data for personal accounts", () => {
    expect(getOfficialAccountCardTokenUsage(account(false), new Map([["account-1", EMPTY_TOKEN_TOTALS]]), []))
      .toBeNull();
  });
});
