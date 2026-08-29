import type { Account } from "../../types";

type AccountSelectorInput = Pick<Account,
  "agentIdentity" | "localProxyCompatible" | "directSwitchCompatible">;

export function getSwitchableAccounts<T extends AccountSelectorInput>(accounts: T[], hotSwitchEnabled: boolean) {
  return accounts.filter((account) => hotSwitchEnabled
    ? account.localProxyCompatible
    : account.directSwitchCompatible);
}

export function getOfficialAuthAccounts<T extends AccountSelectorInput>(accounts: T[]) {
  return accounts.filter((account) => !account.agentIdentity);
}
