import { useEffect, useState } from "react";
import type { UsageWindow } from "../../types";
import { remainingTone, resetCountdownTime, resetCountdownWithDays } from "../../utils/format";
import { MAX_REMAINING_PERCENT } from "./autoSwitchSettings";
import styles from "./GuiAccountUsage.module.less";

const COUNTDOWN_INTERVAL_MS = 1_000;
const DAY_MS = 86_400_000;

function resetCountdown(timestamp: number | null | undefined, now: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  if (timestamp * COUNTDOWN_INTERVAL_MS - now < DAY_MS) return resetCountdownTime(timestamp, now);
  return resetCountdownWithDays(timestamp, "zh", now);
}

export function GuiAccountUsage({ usage, label }: { usage?: UsageWindow | null; label: string }) {
  const [now, setNow] = useState(Date.now);
  const resetsAt = usage?.resetsAt;
  const hasResetTime = Boolean(resetsAt && Number.isFinite(resetsAt));
  useEffect(() => {
    if (!hasResetTime) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), COUNTDOWN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasResetTime, resetsAt]);
  if (!usage || !Number.isFinite(usage.remainingPercent)) return <span className={styles.missing}>暂无用量</span>;
  const remaining = Math.round(Math.min(MAX_REMAINING_PERCENT, Math.max(0, usage.remainingPercent)));
  const countdown = resetCountdown(resetsAt, now);
  const resetLabel = countdown ? `${countdown} 后重置` : "重置时间未知";
  const expired = hasResetTime && (resetsAt ?? 0) * COUNTDOWN_INTERVAL_MS <= now;
  return <div className={styles.usage} data-tone={remainingTone(remaining)}>
    <div className={styles.value}><span>剩余</span><strong>{remaining}%</strong></div>
    <div className={styles.track} role="progressbar" aria-label={`${label}剩余`}
      aria-valuemin={0} aria-valuemax={MAX_REMAINING_PERCENT} aria-valuenow={remaining}>
      <span style={{ width: `${remaining}%` }} />
    </div>
    <span className={styles.reset}>{expired ? "已到重置时间，等待刷新" : resetLabel}</span>
  </div>;
}
