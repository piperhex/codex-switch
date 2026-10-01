import { guiText } from "../../i18n/guiText";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  dragFloatingBubble,
  fetchResetCredits,
  loadAppSettings,
  loadDashboard,
  loadLocalProxyStatus,
  loadProviders,
  queryProviderUsage,
  refreshAccountUsage,
  resizeFloatingUsageWindow,
  showDashboardFromBubble,
  showFloatingBubbleMenu,
  subscribeToBubbleResetDisplayChanges,
  subscribeToBubbleStyleChanges,
  subscribeToBackendEvents,
  subscribeToProviderEvents,
} from "../../api/backend";
import { useFloatingProviderStats } from "../../hooks/useFloatingProviderStats";
import { useLanguage } from "../../hooks/useLanguage";
import { useThemeColor } from "../../hooks/useThemeColor";
import type {
  Account,
  BubbleResetDisplay,
  BubbleStyle,
  LocalProxyStatus,
  Provider,
  UsageSummary,
} from "../../types";
import { remainingTone } from "../../utils/format";
import { ConcurrentUsageCard } from "./ConcurrentUsageCard";
import { FloatingProviderCard } from "../FloatingProviderCard";
import { useConcurrentUsageStats } from "./useConcurrentUsageStats";
import { accountParticipatesInConcurrentRouting } from "./concurrentUsageSummary";
import styles from "./index.module.less";
import { BubbleResetLabel } from "./BubbleResetLabel";
import { ClassicBubbleVisual } from "./ClassicBubbleVisual";

function usageColor(remaining: number) {
  const tone = remainingTone(remaining);
  if (tone === "danger") return "#ef6b62";
  if (tone === "warning") return "#e5b84f";
  return "var(--green-highlight)";
}

const ignoreThemeError = () => undefined;
const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_DELAY_MS = 350;

interface BubblePointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  doubleClick: boolean;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

type FloatingUsageMode = "account" | "concurrent" | "provider";

function bubbleActionLabel(language: "en" | "zh" | "ru", refreshing: boolean, mode: FloatingUsageMode) {
  if (language === "ru") {
    return refreshing ? "Обновление статистики…" : mode === "concurrent"
      ? "Обновить аккаунты и статистику" : "Обновить текущие лимиты";
  }
  if (language === "zh") {
    if (refreshing) return mode === "concurrent" ? "正在刷新并发账号与统计" : "正在刷新当前用量";
    return mode === "concurrent" ? "点击刷新并发账号与统计" : "点击刷新当前用量";
  }
  if (refreshing) return mode === "concurrent" ? "Refreshing concurrent accounts and totals" : "Refreshing usage";
  return mode === "concurrent" ? "Click to refresh concurrent accounts and totals" : "Click to refresh usage";
}

function floatingUsageClassName(mode: FloatingUsageMode, glass: boolean, settling: boolean, refreshing: boolean) {
  if (mode === "concurrent") {
    return ["floating-concurrent-card", refreshing ? "is-refreshing" : ""].filter(Boolean).join(" ");
  }
  let modeClass = "floating-bubble-classic";
  if (mode === "provider") modeClass = "floating-provider-card";
  else if (glass) modeClass = "floating-bubble-glass";
  return ["floating-bubble", modeClass, settling ? "is-water-settling" : "", refreshing ? "is-refreshing" : ""]
    .filter(Boolean)
    .join(" ");
}

export function FloatingUsageBubble() {
  const { language, t } = useLanguage();
  useThemeColor(ignoreThemeError);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [localProxy, setLocalProxy] = useState<LocalProxyStatus | null>(null);
  const [providerUsage, setProviderUsage] = useState<UsageSummary | null>(null);
  const [resetDisplay, setResetDisplay] = useState<BubbleResetDisplay>("countdown");
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>("classic");
  const [resetCreditsRemaining, setResetCreditsRemaining] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [waterSettling, setWaterSettling] = useState(false);
  const lastPrimaryPointerDownAt = useRef(0);
  const pendingClickRefresh = useRef<number | null>(null);
  const pointerGesture = useRef<BubblePointerGesture | null>(null);
  const refreshingRef = useRef(false);
  const previousRemaining = useRef<number | null>(null);
  const providerUsageRequest = useRef(0);

  const load = useCallback(async () => {
    const [{ accounts: nextAccounts }, providers] = await Promise.all([
      loadDashboard(),
      loadProviders(),
    ]);
    setAccounts(nextAccounts);
    const proxy = await loadLocalProxyStatus().catch(() => null);
    if (proxy) setLocalProxy(proxy);
    const active = providers.find((item) => item.active) ?? null;
    const provider = active?.kind === "openai" ? active : null;
    setActiveProvider(active);
    const request = ++providerUsageRequest.current;
    if (!provider) {
      setProviderUsage(null);
      return;
    }
    setProviderUsage(null);
    try {
      const usage = await queryProviderUsage(provider.id);
      if (providerUsageRequest.current === request) setProviderUsage(usage);
    } catch {
      // Keep the bubble available when an older upstream does not expose usage sync yet.
    }
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

  useEffect(() => subscribeToProviderEvents(() => void load()), [load]);

  useEffect(() => {
    loadResetDisplay();
  }, [loadResetDisplay]);

  useEffect(() => subscribeToBubbleResetDisplayChanges(loadResetDisplay), [loadResetDisplay]);
  useEffect(() => subscribeToBubbleStyleChanges(setBubbleStyle), []);

  const account = useMemo(() => accounts.find((item) => item.active), [accounts]);
  const activeUpstreamProvider = activeProvider?.kind === "openai" ? activeProvider : null;
  const activeCustomProvider = activeProvider?.kind === "custom" ? activeProvider : null;
  const concurrentRoutingActive = Boolean(localProxy?.concurrentAccountRoutingEnabled);
  let floatingMode: FloatingUsageMode = "account";
  if (concurrentRoutingActive) floatingMode = "concurrent";
  else if (activeCustomProvider) floatingMode = "provider";
  const concurrentProviders = useMemo(
    () => activeProvider ? [activeProvider] : [],
    [activeProvider],
  );
  const providerStats = useFloatingProviderStats(activeCustomProvider);
  const concurrentAccountGroup = localProxy?.concurrentAccountGroup ?? null;
  const concurrentStats = useConcurrentUsageStats(
    concurrentRoutingActive,
    accounts,
    concurrentProviders,
    concurrentAccountGroup,
  );
  const refreshProviderStats = providerStats.refresh;
  const accountId = account?.id ?? null;

  useEffect(() => {
    const windowMode = concurrentRoutingActive
      ? "concurrentCard"
      : activeCustomProvider ? "providerCard" : bubbleStyle;
    void resizeFloatingUsageWindow(windowMode).catch(() => undefined);
  }, [activeCustomProvider?.id, bubbleStyle, concurrentRoutingActive]);
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
  const usage = providerUsage ?? account?.usage;
  const primary = usage?.primary;
  const secondary = usage?.secondary;
  const remaining = primary ? clampPercent(primary.remainingPercent) : null;
  const weeklyRemaining = secondary ? clampPercent(secondary.remainingPercent) : null;
  const secondaryUsed = weeklyRemaining === null ? null : 100 - weeklyRemaining;
  const status = remaining === null
    ? "--"
    : remainingTone(remaining) === "danger"
      ? ((language === "ru" ? guiText("额度较低", {}, language) : language === "zh" ? "额度较低" : "Low quota"))
      : remainingTone(remaining) === "warning"
        ? ((language === "ru" ? guiText("额度注意", {}, language) : language === "zh" ? "额度注意" : "Quota warning"))
        : ((language === "ru" ? guiText("额度充足", {}, language) : language === "zh" ? "额度充足" : "Quota healthy"));
  const bubbleLabel = bubbleActionLabel(language, refreshing, floatingMode);
  const ringStyle = {
    "--bubble-progress": `${remaining ?? 0}%`,
    "--bubble-color": remaining === null ? "#7b8780" : usageColor(remaining),
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

  const refreshCurrentUsage = useCallback(async () => {
    if ((!account && !activeProvider && !concurrentRoutingActive) || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      if (concurrentRoutingActive) {
        const enabledAccounts = accounts.filter((item) => (
          accountParticipatesInConcurrentRouting(item, concurrentAccountGroup)
        ));
        await Promise.allSettled(enabledAccounts.map((item) => refreshAccountUsage(item.id)));
        await Promise.all([load(), concurrentStats.refresh()]);
      } else if (activeCustomProvider) {
        await refreshProviderStats();
      } else if (activeUpstreamProvider) {
        const usage = await queryProviderUsage(activeUpstreamProvider.id);
        setProviderUsage(usage);
      } else if (account) {
        await refreshAccountUsage(account.id);
        await load();
      }
    } catch {
      await load().catch(() => undefined);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [
    account,
    accounts,
    activeCustomProvider,
    activeProvider,
    activeUpstreamProvider,
    concurrentRoutingActive,
    concurrentAccountGroup,
    concurrentStats.refresh,
    load,
    refreshProviderStats,
  ]);

  useEffect(() => () => {
    if (pendingClickRefresh.current !== null) {
      window.clearTimeout(pendingClickRefresh.current);
    }
  }, []);

  const startPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const now = Date.now();
    const doubleClick = now - lastPrimaryPointerDownAt.current < DOUBLE_CLICK_DELAY_MS;
    if (doubleClick) {
      lastPrimaryPointerDownAt.current = 0;
      if (pendingClickRefresh.current !== null) {
        window.clearTimeout(pendingClickRefresh.current);
        pendingClickRefresh.current = null;
      }
    } else {
      lastPrimaryPointerDownAt.current = now;
    }
    pointerGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      doubleClick,
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
    if (gesture.dragging) return;
    if (gesture.doubleClick) {
      void showDashboardFromBubble();
      return;
    }
    pendingClickRefresh.current = window.setTimeout(() => {
      pendingClickRefresh.current = null;
      void refreshCurrentUsage();
    }, DOUBLE_CLICK_DELAY_MS);
  };

  const cancelPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerGesture.current?.pointerId === event.pointerId) pointerGesture.current = null;
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showFloatingBubbleMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <div className={`${styles.styleScope} floating-usage-window`} onContextMenu={openContextMenu}>
      <button
        type="button"
        className={floatingUsageClassName(floatingMode, bubbleStyle === "glass", waterSettling, refreshing)}
        style={concurrentRoutingActive ? undefined : ringStyle}
        aria-label={bubbleLabel}
        title={bubbleLabel}
        aria-busy={refreshing}
        onPointerDown={startPointerGesture}
        onPointerMove={continuePointerGesture}
        onPointerUp={finishPointerGesture}
        onPointerCancel={cancelPointerGesture}
        onClick={(event) => { if (event.detail === 0) void refreshCurrentUsage(); }}>
        {concurrentRoutingActive ? <ConcurrentUsageCard
          display={concurrentStats.display}
          language={language}
          summary={concurrentStats.summary}
        /> : activeCustomProvider ? <FloatingProviderCard
          balance={providerStats.balance}
          balanceError={providerStats.balanceError}
          language={language}
          loading={providerStats.loading}
          provider={activeCustomProvider}
          t={t}
          tokenUsage={providerStats.tokenUsage}
        /> : <>
          {bubbleStyle === "classic" && <ClassicBubbleVisual
            remaining={remaining}
            weeklyRemaining={weeklyRemaining}
            weekLabel={(language === "ru" ? guiText("周", {}, language) : language === "zh" ? "周" : "W")}
            resetLabel={<BubbleResetLabel timestamp={primary?.resetsAt} language={language} display={resetDisplay} />}
          />}
          {bubbleStyle === "glass" && <><span className="floating-glass-ring" aria-hidden="true">
            <span>{remaining === null ? "--" : `${remaining}%`}</span>
            <small>{(language === "ru" ? guiText("主用量剩余", {}, language) : language === "zh" ? "主用量剩余" : "Primary left")}</small>
          </span>
          <span className="floating-glass-brand">Codex</span>
          <span className="floating-glass-details">
            <span>
              <b>{(language === "ru" ? guiText("距离重置", {}, language) : language === "zh" ? "距离重置" : "Until reset")}</b>
              <BubbleResetLabel timestamp={primary?.resetsAt} language={language} display={resetDisplay}
                className="floating-glass-reset" compact />
            </span>
            <span>
              <b>{(language === "ru" ? guiText("剩余重置", {}, language) : language === "zh" ? "剩余重置" : "Resets left")}</b>
              <strong>
                {resetCreditsRemaining === null ? "--" : `${resetCreditsRemaining}${(language === "ru" ? guiText(" 次", {}, language) : language === "zh" ? " 次" : "")}`}
              </strong>
            </span>
            <span>
              <b>{(language === "ru" ? guiText("次用量已使用", {}, language) : language === "zh" ? "次用量已使用" : "Secondary used")}</b>
              <strong>{secondaryUsed === null ? "--" : `${secondaryUsed}%`}</strong>
            </span>
            <span>
              <b>{(language === "ru" ? guiText("额度状态", {}, language) : language === "zh" ? "额度状态" : "Quota status")}</b>
              <strong className={`floating-glass-status ${remaining === null ? "" : remainingTone(remaining)}`}>
                {status}
              </strong>
            </span>
          </span></>}
        </>}
      </button>
    </div>
  );
}
