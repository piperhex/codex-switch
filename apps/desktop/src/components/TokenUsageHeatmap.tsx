import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "antd";
import { loadDailyTokenUsage } from "../api/backend";
import type { Language, Translate } from "../i18n";
import type { DailyTokenUsage } from "../types";

const DAYS_PER_WEEK = 7;
const TOKEN_USAGE_MORE_THRESHOLD = 100_000_000;

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
    </section>
  );
}
