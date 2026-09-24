import type { ReactNode } from 'react';
import { remainingTone } from '../../utils/format';
import { MAX_REMAINING_PERCENT } from './autoSwitchSettings';
import styles from './ProxyAccountSummary.module.less';

export function GuiPrimaryQuota({ remainingPercent }: { remainingPercent?: number | null }) {
  const remaining = typeof remainingPercent === 'number' && Number.isFinite(remainingPercent)
    ? Math.round(Math.max(0, Math.min(MAX_REMAINING_PERCENT, remainingPercent))) : null;
  if (remaining === null) return <small>主用量剩余 —</small>;
  return <span className={`${styles.quota} ${styles[remainingTone(remaining)]}`}>
    <span className={styles.track} role="progressbar" aria-label="主用量剩余"
      aria-valuemin={0} aria-valuemax={MAX_REMAINING_PERCENT} aria-valuenow={remaining}>
      <span className={styles.fill} style={{ width: `${remaining}%` }} />
    </span>
    <small>{remaining}%</small>
  </span>;
}

export function GuiAccountSummary({ name, plan, detail }: {
  name: string; plan?: string | null; detail: ReactNode;
}) {
  return <span className={styles.current}>
    <span className={styles.identity}>
      <span className={styles.name}>{name}</span>
      {plan && <span className={styles.plan}>{plan}</span>}
    </span>
    {detail}
  </span>;
}
