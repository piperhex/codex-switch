import { describe, expect, it } from "vitest";
import { getOfficialAuthAccounts, getSwitchableAccounts } from "./accountSelectors";

const account = (overrides: Partial<{
  id: string;
  agentIdentity: boolean;
  localProxyCompatible: boolean;
  directSwitchCompatible: boolean;
}>) => ({
  id: "account-1",
  agentIdentity: false,
  localProxyCompatible: true,
  directSwitchCompatible: true,
  ...overrides,
});

describe("account selectors", () => {
  it("returns accounts compatible with the active switching mode", () => {
    const accounts = [
      account({ id: "proxy", localProxyCompatible: true, directSwitchCompatible: false }),
      account({ id: "direct", localProxyCompatible: false, directSwitchCompatible: true }),
      account({ id: "both", localProxyCompatible: true, directSwitchCompatible: true }),
    ];

    expect(getSwitchableAccounts(accounts, true).map(({ id }) => id)).toEqual(["proxy", "both"]);
    expect(getSwitchableAccounts(accounts, false).map(({ id }) => id)).toEqual(["direct", "both"]);
  });

  it("returns only accounts that support official OAuth login state", () => {
    const accounts = [
      account({ id: "oauth", agentIdentity: false }),
      account({ id: "agent", agentIdentity: true }),
    ];

    expect(getOfficialAuthAccounts(accounts).map(({ id }) => id)).toEqual(["oauth"]);
  });
});
