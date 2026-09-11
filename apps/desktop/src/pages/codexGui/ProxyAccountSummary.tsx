import type { Account, Provider } from "../../types";
import { remainingTone } from "../../utils/format";
import { useProviderWallet } from "./useProviderWallet";
import styles from "./ProxyAccountSummary.module.less";

function PrimaryQuota({ account }: { account?: Account }) {
  const value = account?.usage.primary?.remainingPercent;
  const remaining = typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(100, value))) : null;
  if (remaining === null) return <small>主用量剩余 —</small>;
  return <span className={`${styles.quota} ${styles[remainingTone(remaining)]}`}>
    <span className={styles.track} role="progressbar" aria-label="主用量剩余"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}>
      <span className={styles.fill} style={{ width: `${remaining}%` }} />
    </span>
    <small>{remaining}%</small>
  </span>;
}

export function ProxyAccountSummary({ name, account, provider, thirdParty, running, active }: {
  name: string; account?: Account; provider?: Provider; thirdParty: boolean; running: boolean; active: boolean;
}) {
  const wallet = useProviderWallet(provider, active && running);
  const balanceLabel = provider?.balancePlatform === "codexSwitch" ? "剩余额度" : "钱包余额";
  const plan = !thirdParty && account ? account.plan.trim() || "套餐未知" : null;
  let detail = <small>代理未启动</small>;
  if (running) {
    detail = thirdParty ? <small>{wallet === null ? "第三方 Provider" : `${balanceLabel} ${wallet}`}</small>
      : <PrimaryQuota account={account} />;
  }
  return <span className={styles.current}>
    <span className={styles.identity}>
      <span className={styles.name}>{name}</span>
      {plan && <span className={styles.plan}>{plan}</span>}
    </span>
    {detail}
  </span>;
}
