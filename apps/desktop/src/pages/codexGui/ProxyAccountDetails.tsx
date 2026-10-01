import { guiText } from "../../i18n/guiText";
import { remainingTone } from "../../utils/format";
import { MAX_REMAINING_PERCENT } from "./autoSwitchSettings";
import styles from "./ProxyAccountDetails.module.less";

export interface ProxyAccountDetailsProps {
  plan: string;
  primaryRemainingPercent?: number | null;
  secondaryRemainingPercent?: number | null;
}

function QuotaValue({ label, value }: { label: string; value?: number | null }) {
  const remaining = typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(MAX_REMAINING_PERCENT, value))) : null;
  const text = remaining === null ? "—" : `${remaining}%`;
  return <span className={styles.quota} aria-label={guiText("{value1}用量剩余 {value2}", { value1: label, value2: text })}>
    <span>{label}</span>
    <strong className={remaining === null ? undefined : styles[remainingTone(remaining)]}>{text}</strong>
  </span>;
}

export function ProxyAccountDetails({
  plan, primaryRemainingPercent, secondaryRemainingPercent,
}: ProxyAccountDetailsProps) {
  return <span className={styles.details}>
    <span className={styles.plan} data-plan={plan.trim().toLowerCase()}>{plan.trim() || guiText("套餐未知")}</span>
    <QuotaValue label={guiText("主")} value={primaryRemainingPercent} />
    <QuotaValue label={guiText("次")} value={secondaryRemainingPercent} />
  </span>;
}
