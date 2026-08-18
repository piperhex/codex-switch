import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "antd";
import { Signal } from "lucide-react";
import {
  loadAccountTokenUsage,
  loadDailyTokenUsage,
  loadRecentProxySessionLatency,
  subscribeToTokenUsageChanges,
} from "../api/backend";
import type { Language, Translate } from "../i18n";
import type { AccountTokenUsageTotals, DailyTokenUsage, ProxySessionLatencySummary } from "../types";
import { formatCompactTokenCount } from "../utils/tokenContext";
import {
  DailyTokenUsageTooltip,
  EMPTY_TOKEN_TOTALS,
  type TokenTypeTotals,
} from "./DailyTokenUsageTooltip";

const DAYS_PER_WEEK = 7;
const TOKEN_USAGE_MORE_THRESHOLD = 100_000_000;
const EMPTY_PROXY_SESSION_LATENCY: ProxySessionLatencySummary = {
  totalFirstResponseTimeMs: 0,
  requestCount: 0,
};

type ConversationLatencyLevel = "good" | "warning" | "poor" | "unknown";

function formatAverageConversationLatency(summary: ProxySessionLatencySummary) {
  if (!summary.requestCount) return "—";
  return `${(summary.totalFirstResponseTimeMs / summary.requestCount / 1_000).toFixed(1)}s`;
}

function conversationLatencyLevel(summary: ProxySessionLatencySummary): ConversationLatencyLevel {
  if (!summary.requestCount) return "unknown";
  const averageSeconds = summary.totalFirstResponseTimeMs / summary.requestCount / 1_000;
  if (averageSeconds < 2) return "good";
  if (averageSeconds < 3) return "warning";
  return "poor";
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfCalendar(weeks: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * DAYS_PER_WEEK);
  return start;
}

function calendarWeeks(weeks: number) {
  const start = startOfCalendar(weeks);
  return Array.from({ length: weeks }, (_, weekIndex) => (
    Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => {
      const date = new Date(start);
      date.setDate(start.getDate() + weekIndex * DAYS_PER_WEEK + dayIndex);
      return date;
    })
  ));
}

function intensity(total: number, maximum: number) {
  if (total <= 0 || maximum <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((total / maximum) * 4)));
}

function formatTokenCount(value: number, numberFormat: Intl.NumberFormat) {
  if (value < 1_000_000) return numberFormat.format(value);
  const millions = new Intl.NumberFormat(numberFormat.resolvedOptions().locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000);
  return `${millions}M`;
}

function useTodayTokenTotals(refreshSeconds: number) {
  const [usage, setUsage] = useState<AccountTokenUsageTotals[]>([]);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const today = new Date();
        const startTs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1_000;
        const totals = await loadAccountTokenUsage(startTs);
        if (active) setUsage(totals);
      } catch {
        // Keep the last successful totals while token statistics are temporarily unavailable.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(1, refreshSeconds) * 1_000);
    const unsubscribe = subscribeToTokenUsageChanges(() => void refresh());
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [refreshSeconds]);

  return useMemo(() => usage.reduce<TokenTypeTotals>((totals, entry) => ({
    total: totals.total + entry.totalTokens,
    input: totals.input + entry.inputTokens,
    output: totals.output + entry.outputTokens,
    reasoning: totals.reasoning + entry.reasoningTokens,
    cached: totals.cached + entry.cachedTokens,
  }), EMPTY_TOKEN_TOTALS), [usage]);
}

export function TokenUsageHeatmap({
  weeks,
  refreshSeconds,
  language,
  t,
}: {
  weeks: number;
  refreshSeconds: number;
  language: Language;
  t: Translate;
}) {
  const [entries, setEntries] = useState<DailyTokenUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const todayTokenTotals = useTodayTokenTotals(refreshSeconds);
  const [proxySessionLatency, setProxySessionLatency] = useState<ProxySessionLatencySummary>(
    EMPTY_PROXY_SESSION_LATENCY,
  );
  const columns = useMemo(() => calendarWeeks(weeks), [calendarVersion, weeks]);
  const today = dateKey(new Date());

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const startTs = Math.floor(startOfCalendar(weeks).getTime() / 1000);
        const nextEntries = await loadDailyTokenUsage(startTs);
        if (!active) return;
        setEntries(nextEntries);
        setError(null);
        setCalendarVersion((version) => version + 1);
      } catch (nextError) {
        if (active) setError(String(nextError));
      } finally {
        refreshing = false;
        if (active) setLoading(false);
      }
    };

    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshSeconds * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshSeconds, weeks]);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const summary = await loadRecentProxySessionLatency();
        if (active) setProxySessionLatency(summary);
      } catch {
        if (active) setProxySessionLatency(EMPTY_PROXY_SESSION_LATENCY);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const totals = useMemo(
    () => new Map(entries.map((entry) => [entry.date, entry])),
    [entries],
  );
  const total = useMemo(
    () => columns.flat().reduce((sum, date) => sum + (totals.get(dateKey(date))?.totalTokens ?? 0), 0),
    [columns, totals],
  );
  const numberFormat = useMemo(() => new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US"), [language]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }), [language]);
  const legendRanges = useMemo(() => Array.from({ length: 5 }, (_, level) => {
    if (level === 0) return { level, minimum: 0, maximum: 0 };
    return {
      level,
      minimum: level === 1 ? 1 : Math.floor((TOKEN_USAGE_MORE_THRESHOLD * (level - 1)) / 4) + 1,
      maximum: Math.ceil((TOKEN_USAGE_MORE_THRESHOLD * level) / 4),
    };
  }), []);

  return (
    <section className="token-heatmap" aria-label={t("tokenUsage.aria")} aria-busy={loading}>
      <div className="token-heatmap-summary" title={error ?? undefined}>
        <span>{t("tokenUsage.period", { weeks })}</span>
        <strong>{loading && entries.length === 0 ? "--" : formatTokenCount(total, numberFormat)}<small> Tokens</small></strong>
        <span className="token-heatmap-today">
          {t("table.todayTokenUsageLabel")}{language === "zh" ? "：" : ": "}
          <Tooltip title={<DailyTokenUsageTooltip totals={todayTokenTotals} language={language} />} placement="top">
            <b>{formatCompactTokenCount(todayTokenTotals.total, language)}</b>
          </Tooltip>
        </span>
      </div>
      <div className="token-heatmap-chart">
        <div className="token-heatmap-weekdays" aria-hidden="true">
          <span>{language === "zh" ? "一" : "M"}</span>
          <span>{language === "zh" ? "三" : "W"}</span>
          <span>{language === "zh" ? "五" : "F"}</span>
        </div>
        <div className="token-heatmap-content">
          <div className="token-heatmap-scroll">
            <div className="token-heatmap-columns">
              {columns.map((column) => (
                <div className="token-heatmap-week" key={dateKey(column[0])}>
                  {column.map((date) => {
                    const key = dateKey(date);
                    const usage = totals.get(key);
                    const tokens = usage?.totalTokens ?? 0;
                    const future = key > today;
                    const cell = (
                      <span
                        className={`token-heatmap-cell level-${intensity(tokens, TOKEN_USAGE_MORE_THRESHOLD)}${future ? " future" : ""}`}
                        aria-hidden="true"
                      />
                    );
                    if (future) return <span key={key}>{cell}</span>;
                    return (
                      <Tooltip
                        key={key}
                        title={(
                          <div className="token-heatmap-tooltip">
                            <strong>{dateFormat.format(date)}</strong>
                            <div className="token-heatmap-tooltip-details">
                              <span><b>{t("tokenUsage.total")}</b>{formatTokenCount(tokens, numberFormat)}</span>
                              <span><b>{t("tokenUsage.input")}</b>{formatTokenCount(usage?.inputTokens ?? 0, numberFormat)}</span>
                              <span><b>{t("tokenUsage.output")}</b>{formatTokenCount(usage?.outputTokens ?? 0, numberFormat)}</span>
                              <span><b>{t("tokenUsage.reasoning")}</b>{formatTokenCount(usage?.reasoningTokens ?? 0, numberFormat)}</span>
                              <span><b>{t("tokenUsage.cached")}</b>{formatTokenCount(usage?.cachedTokens ?? 0, numberFormat)}</span>
                            </div>
                          </div>
                        )}
                      >
                        {cell}
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="token-heatmap-footer">
            <Tooltip title={t("table.averageConversationLatencyTooltip", {
              requests: proxySessionLatency.requestCount,
            })} styles={{ root: { maxWidth: 400 } }}>
              <span
                className={`conversation-latency-indicator is-${conversationLatencyLevel(proxySessionLatency)}`}
                aria-label={`${t("table.averageConversationLatencyLabel")}: ${
                  formatAverageConversationLatency(proxySessionLatency)
                }`}
              >
                <span>{t("table.averageConversationLatencyLabel")}{language === "zh" ? "：" : ": "}</span>
                <Signal size={13} strokeWidth={2.5} aria-hidden="true" />
                <strong>{formatAverageConversationLatency(proxySessionLatency)}</strong>
              </span>
            </Tooltip>
            <div className="token-heatmap-legend">
              <span>{t("tokenUsage.less")}</span>
              <div className="token-heatmap-legend-scale">
                {legendRanges.map((range) => (
                  <Tooltip key={range.level} title={range.level === 0
                    ? t("tokenUsage.rangeZero")
                    : t("tokenUsage.range", {
                      minimum: formatTokenCount(range.minimum, numberFormat),
                      maximum: formatTokenCount(range.maximum, numberFormat),
                    })}>
                    <span className={`token-heatmap-cell level-${range.level}`} />
                  </Tooltip>
                ))}
              </div>
              <span>{t("tokenUsage.more")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
