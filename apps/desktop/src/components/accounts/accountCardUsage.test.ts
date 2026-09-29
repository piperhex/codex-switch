import { describe, expect, it } from "vitest";
import type { Account, AccountTokenUsageTotals } from "../../types";
import { EMPTY_TOKEN_TOTALS } from "../DailyTokenUsageTooltip";
import { createAccountTokenUsageLookup } from "./accountCardUsage";

function account(official: boolean): Account {
  return {
    id: "account-1",
    email: "official@example.com",
    group: "",
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

    expect(createAccountTokenUsageLookup([account(true)], usage)(account(true)))
      .toEqual({ totals: { total: 1200, input: 800, output: 300, reasoning: 50, cached: 50 },
        estimatedCost: 0.0123 });
  });

  it("returns token footer data for personal accounts too", () => {
    expect(createAccountTokenUsageLookup([account(false)], [])(account(false)))
      .toEqual({ totals: EMPTY_TOKEN_TOTALS, estimatedCost: 0 });
  });
});

const target = { ...account(true), accountId: "workspace-1" };
const entry: AccountTokenUsageTotals = {
  accountId: target.id, accountEmail: target.email, totalTokens: 1200,
  inputTokens: 800, outputTokens: 400, reasoningTokens: 50, cachedTokens: 200, estimatedCost: 0.25,
};

describe("account card and table usage matching", () => {
  it("matches the managed ID without an email", () => {
    const lookup = createAccountTokenUsageLookup([target], [{ ...entry, accountEmail: null }]);
    expect(lookup(target)).toEqual({
      totals: { total: 1200, input: 800, output: 400, reasoning: 50, cached: 200 }, estimatedCost: 0.25,
    });
  });

  it("adds all matching historical records to both tokens and cost", () => {
    const lookup = createAccountTokenUsageLookup([target], [entry,
      { ...entry, accountId: target.accountId, accountEmail: null },
      { ...entry, accountId: null, accountEmail: ` ${target.email.toUpperCase()} ` },
    ]);
    expect(lookup(target)).toEqual({
      totals: { total: 3600, input: 2400, output: 1200, reasoning: 150, cached: 600 }, estimatedCost: 0.75,
    });
  });

  it("prefers the exact managed ID over another account with the same email and workspace", () => {
    const duplicate = { ...target, id: "account-2" };
    const lookup = createAccountTokenUsageLookup([duplicate, target], [entry]);
    expect(lookup(target).totals.total).toBe(1200);
    expect(lookup(duplicate)).toEqual({ totals: EMPTY_TOKEN_TOTALS, estimatedCost: 0 });
  });

  it("uses email to distinguish accounts sharing a workspace in legacy records", () => {
    const colleague = { ...target, id: "account-2", email: "colleague@example.com" };
    const lookup = createAccountTokenUsageLookup([colleague, target], [{ ...entry, accountId: target.accountId }]);
    expect(lookup(target).estimatedCost).toBe(0.25);
    expect(lookup(colleague).estimatedCost).toBe(0);
  });

  it("ignores unmatched records", () => {
    const lookup = createAccountTokenUsageLookup([target], [{
      ...entry, accountId: "unknown", accountEmail: "unknown@example.com",
    }]);
    expect(lookup(target)).toEqual({ totals: EMPTY_TOKEN_TOTALS, estimatedCost: 0 });
  });
});
