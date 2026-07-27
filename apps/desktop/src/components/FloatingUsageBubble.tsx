import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  dragFloatingBubble,
  fetchResetCredits,
  loadAppSettings,
  loadDashboard,
  loadTokenUsageEntries,
  refreshAccountUsage,
  showDashboardFromBubble,
  showFloatingBubbleMenu,
  subscribeToBubbleResetDisplayChanges,
  subscribeToBubbleStyleChanges,
  subscribeToBackendEvents,
  subscribeToTokenUsageChanges,
} from "../api/backend";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import type { Account, BubbleResetDisplay, BubbleStyle, TokenUsageEntry } from "../types";
import { remainingTone, resetClockTime } from "../utils/format";
import { formatCompactTokenCount, latestTokenContextForAccount } from "../utils/tokenContext";

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
const DRAG_THRESHOLD_PX = 5;

interface BubblePointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function BubbleResetLabel({ timestamp, language, display, className, compact = false }: {
  timestamp?: number | null;
  language: "en" | "zh";
  display: BubbleResetDisplay;
  className?: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timestamp || display !== "countdown") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [display, timestamp]);

  if (display === "resetAt") {
    const clock = resetClockTime(timestamp);
    if (compact) {
      return (
        <small className={`floating-bubble-reset ${className ?? ""}`}>
          <span>{clock ?? (language === "zh" ? "未知" : "unknown")}</span>
        </small>
      );
    }
    return (
      <small className={`floating-bubble-reset floating-bubble-reset-stacked ${className ?? ""}`}>
        <span>{language === "zh" ? (clock ? "重置于" : "重置时间") : (clock ? "Resets at" : "Reset time")}</span>
        <span>{clock ?? (language === "zh" ? "未知" : "unknown")}</span>
      </small>
    );
  }

  const totalSeconds = timestamp ? Math.max(0, Math.ceil((timestamp * 1000 - now) / 1000)) : null;
  const days = totalSeconds === null ? null : Math.floor(totalSeconds / 86_400);
  const hours = totalSeconds === null ? null : Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = totalSeconds === null ? null : Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds === null ? null : totalSeconds % 60;
  const time = hours === null || minutes === null || seconds === null
    ? null
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (compact) {
    return (
      <small className={`floating-bubble-reset ${className ?? ""}`}>
        <span>{time ? `${days}${language === "zh" ? "天" : "d"}\u00a0${time}` : "--"}</span>
      </small>
    );
  }
  return (
    <small className={`floating-bubble-reset floating-bubble-reset-stacked ${className ?? ""}`}>
      {time ? <><span>{days}{language === "zh" ? "天" : "d"}</span><span>{time}</span></> : <span>--</span>}
    </small>
  );
}

export function FloatingUsageBubble() {
  const { language } = useLanguage();
  useThemeColor(ignoreThemeError);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tokenUsageEntries, setTokenUsageEntries] = useState<TokenUsageEntry[]>([]);
  const [resetDisplay, setResetDisplay] = useState<BubbleResetDisplay>("countdown");
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>("classic");
  const [resetCreditsRemaining, setResetCreditsRemaining] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [waterSettling, setWaterSettling] = useState(false);
  const lastPrimaryPointerDownAt = useRef(0);
  const pointerGesture = useRef<BubblePointerGesture | null>(null);
  const refreshingRef = useRef(false);
  const previousRemaining = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { accounts: nextAccounts } = await loadDashboard();
    setAccounts(nextAccounts);
  }, []);
  const loadResetDisplay = useCallback(() => {
    void loadAppSettings()
      .then((settings) => {
        setResetDisplay(settings.bubbleResetDisplay);
        setBubbleStyle(settings.bubbleStyle);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
    return subscribeToBackendEvents(load, load);
  }, [load]);

  const loadTokenContext = useCallback(() => {
    void loadTokenUsageEntries()
      .then(setTokenUsageEntries)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadTokenContext();
    return subscribeToTokenUsageChanges(loadTokenContext);
  }, [loadTokenContext]);

  useEffect(() => {
    loadResetDisplay();
  }, [loadResetDisplay]);

  useEffect(() => subscribeToBubbleResetDisplayChanges(loadResetDisplay), [loadResetDisplay]);
  useEffect(() => subscribeToBubbleStyleChanges(setBubbleStyle), []);

  const account = useMemo(() => accounts.find((item) => item.active), [accounts]);
  const accountId = account?.id ?? null;
  useEffect(() => {
    let active = true;
    if (!accountId) {
      setResetCreditsRemaining(null);
      return () => { active = false; };
    }
    setResetCreditsRemaining(null);
    void fetchResetCredits(accountId)
      .then((summary) => {
        if (active) setResetCreditsRemaining(summary.credits.length);
      })
      .catch(() => {
        if (active) setResetCreditsRemaining(null);
    });
    return () => { active = false; };
  }, [accountId]);
  const tokenContext = useMemo(
    () => account ? latestTokenContextForAccount(tokenUsageEntries, account) : null,
    [account, tokenUsageEntries],
  );
  const primary = account?.usage.primary;
  const secondary = account?.usage.secondary;
  const remaining = primary ? clampPercent(primary.remainingPercent) : null;
  const weeklyRemaining = secondary ? clampPercent(secondary.remainingPercent) : null;
  const ringRemaining = bubbleStyle === "glass" ? remaining : weeklyRemaining;
  const water = waterColors(remaining);
  const secondaryUsed = weeklyRemaining === null ? null : 100 - weeklyRemaining;
  const status = remaining === null
    ? "--"
    : remainingTone(remaining) === "danger"
      ? (language === "zh" ? "额度较低" : "Low quota")
      : remainingTone(remaining) === "warning"
        ? (language === "zh" ? "额度注意" : "Quota warning")
        : (language === "zh" ? "额度充足" : "Quota healthy");
  const bubbleLabel = language === "zh"
    ? (refreshing ? "正在刷新当前账号额度" : "点击刷新当前账号额度")
    : (refreshing ? "Refreshing current account quota" : "Click to refresh current account quota");
  const bubbleHover = language === "zh"
    ? `${bubbleLabel}\n可用上下文：${tokenContext ? formatCompactTokenCount(tokenContext.availableTokens, language) : "--"}\n总上下文：${tokenContext ? formatCompactTokenCount(tokenContext.totalTokens, language) : "--"}`
    : `${bubbleLabel}\nAvailable context: ${tokenContext ? formatCompactTokenCount(tokenContext.availableTokens, language) : "--"}\nTotal context: ${tokenContext ? formatCompactTokenCount(tokenContext.totalTokens, language) : "--"}`;
  const ringStyle = {
    "--bubble-progress": `${ringRemaining ?? 0}%`,
    "--bubble-color": ringRemaining === null ? "#7b8780" : usageColor(ringRemaining),
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

  const refreshCurrentAccount = useCallback(async () => {
    if (!account || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refreshAccountUsage(account.id);
      await load();
    } catch {
      await load().catch(() => undefined);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [account, load]);

  const startPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const now = Date.now();
    if (now - lastPrimaryPointerDownAt.current < 350) {
      lastPrimaryPointerDownAt.current = 0;
      pointerGesture.current = null;
      void showDashboardFromBubble();
      return;
    }
    lastPrimaryPointerDownAt.current = now;
    pointerGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continuePointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.dragging || !(event.buttons & 1)) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) return;
    gesture.dragging = true;
    lastPrimaryPointerDownAt.current = 0;
    event.preventDefault();
    void dragFloatingBubble();
  };

  const finishPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!gesture.dragging) void refreshCurrentAccount();
  };

  const cancelPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerGesture.current?.pointerId === event.pointerId) pointerGesture.current = null;
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showFloatingBubbleMenu();
  };

  return (
    <div className="floating-usage-window" onContextMenu={openContextMenu}>
      <button type="button" className={`floating-bubble ${bubbleStyle === "glass" ? "floating-bubble-glass" : ""} ${waterSettling ? "is-water-settling" : ""} ${refreshing ? "is-refreshing" : ""}`} style={ringStyle}
        aria-label={bubbleLabel}
        title={bubbleHover}
        aria-busy={refreshing}
        onPointerDown={startPointerGesture}
        onPointerMove={continuePointerGesture}
        onPointerUp={finishPointerGesture}
        onPointerCancel={cancelPointerGesture}
        onClick={(event) => { if (event.detail === 0) void refreshCurrentAccount(); }}>
        <span className="floating-bubble-water" aria-hidden="true" />
        <span className="floating-bubble-weekly" aria-hidden="true">
          {language === "zh" ? "周" : "W"} {weeklyRemaining === null ? "--" : `${weeklyRemaining}%`}
        </span>
        <span className="floating-bubble-value">{remaining === null ? "--" : `${remaining}%`}</span>
        <BubbleResetLabel timestamp={primary?.resetsAt} language={language} display={resetDisplay} />
        <span className="floating-glass-ring" aria-hidden="true"><span>{remaining === null ? "--" : `${remaining}%`}</span><small>{language === "zh" ? "主用量剩余" : "Primary left"}</small></span>
        <span className="floating-glass-brand">Codex</span>
        <span className="floating-glass-details">
          <span><b>{language === "zh" ? "距离重置" : "Until reset"}</b><BubbleResetLabel timestamp={primary?.resetsAt} language={language} display={resetDisplay} className="floating-glass-reset" compact /></span>
          <span><b>{language === "zh" ? "剩余重置" : "Resets left"}</b><strong>{resetCreditsRemaining === null ? "--" : `${resetCreditsRemaining}${language === "zh" ? " 次" : ""}`}</strong></span>
          <span><b>{language === "zh" ? "次用量已使用" : "Secondary used"}</b><strong>{secondaryUsed === null ? "--" : `${secondaryUsed}%`}</strong></span>
          <span><b>{language === "zh" ? "额度状态" : "Quota status"}</b><strong className={`floating-glass-status ${remaining === null ? "" : remainingTone(remaining)}`}>{status}</strong></span>
        </span>
      </button>
    </div>
  );
}
