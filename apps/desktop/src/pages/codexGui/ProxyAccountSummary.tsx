import type { Account, Provider } from "../../types";
import { GuiAccountSummary, GuiPrimaryQuota } from "./GuiAccountSummary";
import { useProviderWallet } from "./useProviderWallet";

export function ProxyAccountSummary({ name, account, provider, thirdParty, running, active }: {
  name: string; account?: Account; provider?: Provider; thirdParty: boolean; running: boolean; active: boolean;
}) {
  const wallet = useProviderWallet(provider, active && running);
  const balanceLabel = provider?.balancePlatform === "codexSwitch" ? "剩余额度" : "钱包余额";
  const plan = !thirdParty && account ? account.plan.trim() || "套餐未知" : null;
  let detail = <small>代理未启动</small>;
  if (running) {
    detail = thirdParty ? <small>{wallet === null ? "第三方 Provider" : `${balanceLabel} ${wallet}`}</small>
      : <GuiPrimaryQuota remainingPercent={account?.usage.primary?.remainingPercent} />;
  }
  return <GuiAccountSummary name={name} plan={plan} detail={detail} />;
}
