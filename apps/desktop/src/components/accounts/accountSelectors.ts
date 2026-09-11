import type { Account } from "../../types";

type AccountSelectorInput = Pick<Account,
  "localProxyCompatible" | "directSwitchCompatible">;

export function getSwitchableAccounts<T extends AccountSelectorInput>(accounts: T[], hotSwitchEnabled: boolean) {
  return accounts.filter((account) => hotSwitchEnabled
    ? account.localProxyCompatible
    : account.directSwitchCompatible);
}
