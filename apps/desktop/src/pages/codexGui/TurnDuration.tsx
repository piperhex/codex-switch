import { guiText } from "../../i18n/guiText";
import { useEffect, useState } from "react";
import type { Turn } from "./types";
import { formatTurnDuration, SECOND_MS, turnElapsedMs } from "./turnTiming";
import styles from "./styles.module.less";

export function TurnDuration({ turn, running, active, fallback, inline = false }: {
  turn: Turn; running: boolean; active: boolean; fallback?: string; inline?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running || !active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [turn.id, running, active]);
  const elapsed = turnElapsedMs(turn, now);
  const Element = inline ? "span" : "div";
  if (turn.status === "interrupted") return <Element className={styles.turnDuration}>
    {guiText("已停止生成")}{elapsed != null && guiText(" · 用时 {value1}", { value1: formatTurnDuration(elapsed) })}
  </Element>;
  if (elapsed == null || (turn.status === "inProgress" && !running)) return fallback ? <span>{fallback}</span> : null;
  return <Element className={styles.turnDuration}>
    {running ? guiText("已处理") : guiText("用时")} {formatTurnDuration(elapsed)}
  </Element>;
}
