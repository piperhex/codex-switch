import { useEffect, useState } from "react";
import { PROCESSING_LABELS, type ProcessingPhase } from "./processing";
import { formatTurnDuration, SECOND_MS } from "./turnTiming";
import styles from "./styles.module.less";
import activeStyles from "./activeText.module.less";

export function WorkingStatus({ phase, startedAtMs, active }: {
  phase: ProcessingPhase; startedAtMs?: number; active: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [observedAt] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [active, startedAtMs, phase]);
  const elapsed = Math.max(0, now - (startedAtMs ?? observedAt));
  return <div className={styles.working} role="status" data-processing-phase={phase}>
    <span className={styles.runningDot} aria-hidden="true" />
    <span className={activeStyles.text}>{PROCESSING_LABELS[phase]} ·{" "}
      <span aria-live="off">{formatTurnDuration(elapsed)}</span></span>
  </div>;
}
