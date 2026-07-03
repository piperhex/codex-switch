import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  dragFloatingBubble,
  loadDashboard,
  showDashboardFromBubble,
  showFloatingBubbleMenu,
  subscribeToBackendEvents,
} from "../api/backend";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import type { Account } from "../types";
import { remainingTone, resetClockTime } from "../utils/format";

function usageColor(remaining: number) {
  const tone = remainingTone(remaining);
  if (tone === "danger") return "#ef6b62";
  if (tone === "warning") return "#e5b84f";
  return "var(--green-highlight)";
}

function waterColors(remaining: number | null) {
  const tone = remaining === null ? "good" : remainingTone(remaining);
  if (tone === "danger") return { top: "#ff8a78", main: "#ef4f45", bottom: "#c92e32" };
  if (tone === "warning") return { top: "#ffd76a", main: "#e5b84f", bottom: "#c88716" };
  return { top: "#20b7ed", main: "#0b93d9", bottom: "#0873d5" };
}

const ignoreThemeError = () => undefined;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function BubbleResetLabel({ timestamp, language }: { timestamp?: number | null; language: "en" | "zh" }) {
  const clock = resetClockTime(timestamp);
  return (
    <small className="floating-bubble-reset floating-bubble-reset-stacked">
      <span>{language === "zh" ? (clock ? "重置于" : "重置时间") : (clock ? "Resets at" : "Reset time")}</span>
      <span>{clock ?? (language === "zh" ? "未知" : "unknown")}</span>
    </small>
  );
}

export function FloatingUsageBubble() {
  const { language } = useLanguage();
  useThemeColor(ignoreThemeError);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [waterSettling, setWaterSettling] = useState(false);
  const lastPrimaryPointerDownAt = useRef(0);
  const previousRemaining = useRef<number | null>(null);

  const load = useCallback(() => {
    void loadDashboard().then(({ accounts: nextAccounts }) => setAccounts(nextAccounts));
  }, []);

  useEffect(() => {
    load();
    return subscribeToBackendEvents(load, load);
  }, [load]);

  const account = useMemo(() => accounts.find((item) => item.active), [accounts]);
  const primary = account?.usage.primary;
  const secondary = account?.usage.secondary;
  const remaining = primary ? clampPercent(primary.remainingPercent) : null;
  const weeklyRemaining = secondary ? clampPercent(secondary.remainingPercent) : null;
  const water = waterColors(remaining);
  const ringStyle = {
    "--bubble-progress": `${weeklyRemaining ?? 0}%`,
    "--bubble-color": weeklyRemaining === null ? "#7b8780" : usageColor(weeklyRemaining),
    "--bubble-water-level": `${remaining ?? 0}%`,
    "--bubble-water-top": water.top,
    "--bubble-water-color": water.main,
    "--bubble-water-bottom": water.bottom,
  } as CSSProperties;

  useEffect(() => {
    if (remaining === null) {
      previousRemaining.current = null;
      setWaterSettling(false);
      return;
    }
    const previous = previousRemaining.current;
    previousRemaining.current = remaining;
    if (previous !== null && remaining < previous) {
      setWaterSettling(true);
      const timer = window.setTimeout(() => setWaterSettling(false), 1100);
      return () => window.clearTimeout(timer);
    }
  }, [remaining]);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastPrimaryPointerDownAt.current < 350) {
      lastPrimaryPointerDownAt.current = 0;
      void showDashboardFromBubble();
      return;
    }
    lastPrimaryPointerDownAt.current = now;
    void dragFloatingBubble();
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showFloatingBubbleMenu();
  };

  return (
    <div className="floating-usage-window" onContextMenu={openContextMenu}>
      <button type="button" className={`floating-bubble ${waterSettling ? "is-water-settling" : ""}`} style={ringStyle}
        aria-label={language === "zh" ? "当前账号 5 小时用量" : "Current account 5-hour usage"}
        onPointerDown={startDrag}>
        <span className="floating-bubble-water" aria-hidden="true" />
        <span className="floating-bubble-weekly" aria-hidden="true">
          {language === "zh" ? "周" : "W"} {weeklyRemaining === null ? "--" : `${weeklyRemaining}%`}
        </span>
        <span className="floating-bubble-value">{remaining === null ? "--" : `${remaining}%`}</span>
        <BubbleResetLabel timestamp={primary?.resetsAt} language={language} />
      </button>
    </div>
  );
}
