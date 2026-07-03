import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  dragFloatingBubble,
  loadDashboard,
  resizeFloatingBubble,
  showDashboardFromBubble,
  showFloatingBubbleMenu,
  subscribeToBackendEvents,
} from "../api/backend";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import type { Account, UsageWindow } from "../types";
import { formatUpdated, remainingTone, resetClockTime, resetLabel, type UsageResetWindow } from "../utils/format";

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

function DetailRow({ label, usage, language, resetWindow }: {
  label: string;
  usage?: UsageWindow | null;
  language: "en" | "zh";
  resetWindow: UsageResetWindow;
}) {
  if (!usage) {
    const emptyStyle = {
      "--bubble-detail-progress": "0%",
      "--bubble-detail-color": "#6f7d74",
    } as CSSProperties;
    return (
      <div className={`bubble-detail-row bubble-detail-row-${resetWindow}`} style={emptyStyle}>
        <div className="bubble-detail-row-head"><b>{label}</b><span>--</span></div>
        <div className="bubble-detail-progress" aria-hidden="true"><i /></div>
      </div>
    );
  }
  const remaining = clampPercent(usage.remainingPercent);
  const progressStyle = {
    "--bubble-detail-progress": `${remaining}%`,
    "--bubble-detail-color": usageColor(remaining),
  } as CSSProperties;
  return (
    <div className={`bubble-detail-row bubble-detail-row-${resetWindow}`} style={progressStyle}>
      <div className="bubble-detail-row-head">
        <b>{label}</b>
        <span>{language === "zh" ? `剩余 ${remaining}%` : `${remaining}% left`}</span>
      </div>
      <div className="bubble-detail-progress" aria-hidden="true"><i /></div>
      <small>{resetLabel(usage.resetsAt, language, resetWindow)}</small>
    </div>
  );
}

function BubbleResetLabel({ timestamp, language }: { timestamp?: number | null; language: "en" | "zh" }) {
  const clock = resetClockTime(timestamp);
  if (language === "en") {
    return (
      <small className="floating-bubble-reset floating-bubble-reset-en">
        <span>{clock ? "Resets at" : "Reset time"}</span>
        <span>{clock ?? "unknown"}</span>
      </small>
    );
  }
  return <small className="floating-bubble-reset">{resetLabel(timestamp, language, "fiveHours")}</small>;
}

export function FloatingUsageBubble() {
  const { language } = useLanguage();
  useThemeColor(ignoreThemeError);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState(false);
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

  const setHover = (nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    void resizeFloatingBubble(nextExpanded);
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastPrimaryPointerDownAt.current < 350) {
      lastPrimaryPointerDownAt.current = 0;
      setExpanded(false);
      void resizeFloatingBubble(false).then(showDashboardFromBubble);
      return;
    }
    lastPrimaryPointerDownAt.current = now;
    setExpanded(false);
    void resizeFloatingBubble(false).then(dragFloatingBubble);
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
    void resizeFloatingBubble(false).then(showFloatingBubbleMenu);
  };

  return (
    <div className={`floating-usage-window ${expanded ? "is-expanded" : ""}`}
      onContextMenu={openContextMenu}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {expanded && (
        <aside className="bubble-details">
          <header>
            <span>{language === "zh" ? "当前账号" : "Current account"}</span>
            <strong title={account?.email}>{account?.email ?? (language === "zh" ? "暂无账号" : "No account")}</strong>
            {account && <small>{account.plan}</small>}
          </header>
          <DetailRow label="5h" usage={primary} language={language} resetWindow="fiveHours" />
          <DetailRow label={language === "zh" ? "1 周" : "1 week"} usage={account?.usage.secondary} language={language} resetWindow="oneWeek" />
          <footer>{language === "zh" ? "更新于 " : "Updated "}{formatUpdated(account?.usage.fetchedAt, language)}</footer>
        </aside>
      )}
      <button type="button" className={`floating-bubble ${waterSettling ? "is-water-settling" : ""}`} style={ringStyle}
        aria-label={language === "zh" ? "当前账号 5 小时用量" : "Current account 5-hour usage"}
        onPointerDown={startDrag}>
        <span className="floating-bubble-water" aria-hidden="true" />
        <span className="floating-bubble-value">{remaining === null ? "--" : `${remaining}%`}</span>
        <BubbleResetLabel timestamp={primary?.resetsAt} language={language} />
      </button>
    </div>
  );
}
