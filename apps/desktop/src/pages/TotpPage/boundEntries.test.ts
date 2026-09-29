import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS } from "../../demo";
import { generateTotp } from "../../utils/totp";
import { toBoundTotpEntries } from "./boundEntries";

describe("account-bound authenticator entries", () => {
  it("keeps valid account codes while ignoring missing and malformed secrets", async () => {
    const accounts = ["", "invalid!", "GEZDGNBV GY3TQOJQ GEZDGNBV GY3TQOJQ"].map((secret, index) => ({
      ...DEMO_ACCOUNTS[0],
      id: `account-${index}`,
      privateDetails: { ...DEMO_ACCOUNTS[0].privateDetails, totpSecret: secret },
    }));
    const entries = toBoundTotpEntries(accounts);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "account:account-2", accountName: accounts[2].email });
    // RFC 6238's first SHA-1 vector, using the six digits shown for account codes.
    expect(await generateTotp(entries[0], 59_000)).toBe("287082");
    expect(accounts[2].privateDetails.totpSecret).toContain(" ");
  });

  it("reflects changes to account secrets and removes codes after a secret is cleared", () => {
    const account = { ...DEMO_ACCOUNTS[0], privateDetails: {
      ...DEMO_ACCOUNTS[0].privateDetails, totpSecret: "JBSWY3DPEHPK3PXP",
    } };
    expect(toBoundTotpEntries([account])[0].secret).toBe("JBSWY3DPEHPK3PXP");
    account.privateDetails.totpSecret = "";
    expect(toBoundTotpEntries([account])).toEqual([]);
  });
});
