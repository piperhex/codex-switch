import { describe, expect, it } from "vitest";
import type { Account } from "../../types";
import { canReceiveConcurrentConversation } from "./concurrentAccountEligibility";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    email: "one@example.com",
    group: "Work",
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
    official: true,
    metadataEditable: true,
    usage: {
      primary: { usedPercent: 80, remainingPercent: 20 },
      secondary: { usedPercent: 70, remainingPercent: 30 },
    },
    ...overrides,
  };
}

const defaultOptions = { accountGroup: null, minimumPrimaryRemaining: null };

describe("canReceiveConcurrentConversation", () => {
  it("excludes an account when either reported quota window is exhausted", () => {
    const exhaustedPrimary = account({
      usage: { primary: { usedPercent: 100, remainingPercent: 0 } },
    });
    const exhaustedSecondary = account({
      usage: {
        primary: { usedPercent: 80, remainingPercent: 20 },
        secondary: { usedPercent: 100, remainingPercent: 0 },
      },
    });

    expect(canReceiveConcurrentConversation(exhaustedPrimary, defaultOptions)).toBe(false);
    expect(canReceiveConcurrentConversation(exhaustedSecondary, defaultOptions)).toBe(false);
  });

  it("allows an account when an optional quota window is not reported", () => {
    expect(canReceiveConcurrentConversation(account({ usage: {} }), defaultOptions)).toBe(true);
  });

  it("applies the selected group and configured primary threshold", () => {
    expect(canReceiveConcurrentConversation(account(), {
      accountGroup: "Home",
      minimumPrimaryRemaining: null,
    })).toBe(false);
    expect(canReceiveConcurrentConversation(account(), {
      accountGroup: "Work",
      minimumPrimaryRemaining: 25,
    })).toBe(false);
    expect(canReceiveConcurrentConversation(account(), {
      accountGroup: "Work",
      minimumPrimaryRemaining: 20,
    })).toBe(true);
  });
});
