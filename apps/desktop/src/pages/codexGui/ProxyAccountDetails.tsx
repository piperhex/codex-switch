import type { UsageSummary, UsageWindow } from "../../types";
import { remainingTone } from "../../utils/format";
import styles from "./ProxyAccountDetails.module.less";

function QuotaValue({ label, window: usageWindow }: { label: string; window?: UsageWindow | null }) {
  const value = usageWindow?.remainingPercent;
  const remaining = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
  const text = remaining === null ? "—" : `${remaining}%`;
  return <span className={styles.quota} aria-label={`${label}用量剩余 ${text}`}>
    <span>{label}</span>
    <strong className={remaining === null ? undefined : styles[remainingTone(remaining)]}>{text}</strong>
  </span>;
}

export function ProxyAccountDetails({ plan, usage }: { plan: string; usage: UsageSummary }) {
  return <span className={styles.details}>
    <span>{plan.trim() || "套餐未知"}</span>
    <QuotaValue label="主" window={usage.primary} />
    <QuotaValue label="次" window={usage.secondary} />
  </span>;
}
