import type { Account, Provider } from "../../types";
import { GuiAccountSummary, GuiPrimaryQuota } from "./GuiAccountSummary";
import { useProviderWallet } from "./useProviderWallet";

export function ProxyAccountSummary({ name, account, provider, thirdParty, active }: {
  name: string; account?: Account; provider?: Provider; thirdParty: boolean; active: boolean;
}) {
  const wallet = useProviderWallet(provider, active);
  const balanceLabel = provider?.balancePlatform === "codexSwitch" ? "剩余额度" : "钱包余额";
  const plan = !thirdParty && account ? account.plan.trim() || "套餐未知" : null;
  const detail = thirdParty ? <small>{wallet === null ? "第三方 Provider" : `${balanceLabel} ${wallet}`}</small>
    : <GuiPrimaryQuota remainingPercent={account?.usage.primary?.remainingPercent} />;
  return <GuiAccountSummary name={name} plan={plan} detail={detail} />;
}
