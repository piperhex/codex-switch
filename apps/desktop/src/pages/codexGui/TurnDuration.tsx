import { useEffect, useState } from "react";
import type { Turn } from "./types";
import { formatTurnDuration, SECOND_MS, turnElapsedMs } from "./turnTiming";
import styles from "./styles.module.less";

export function TurnDuration({ turn, running, active }: { turn: Turn; running: boolean; active: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running || !active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [turn.id, running, active]);
  const elapsed = turnElapsedMs(turn, now);
  if (elapsed == null || (turn.status === "inProgress" && !running)) return null;
  return <div className={styles.turnDuration}>
    {running ? "已处理" : "用时"} {formatTurnDuration(elapsed)}
  </div>;
}
