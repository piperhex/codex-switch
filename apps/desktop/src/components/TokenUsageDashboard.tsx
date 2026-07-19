import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, InputNumber } from "antd";
import { BarChart, HeatmapChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { init, use } from "echarts/core";
import type { EChartsCoreOption as EChartsOption, EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { RefreshCw } from "lucide-react";
import { loadDailyTokenUsage, loadTokenUsageEntries } from "../api/backend";
import { MAX_TOKEN_USAGE_WEEKS, MIN_TOKEN_USAGE_WEEKS } from "../hooks/useTokenUsagePreferences";
import type { Language } from "../i18n";
import type { DailyTokenUsage, TokenUsageEntry } from "../types";
import { normalizeThemeColor } from "../utils/theme";

const TOKEN_USAGE_MORE_THRESHOLD = 100_000_000;
const MAX_RANKING_ITEMS = 8;

use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  AriaComponent,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function startOfCalendar(weeks: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
  return start;
}

function calendarDateKeys(weeks: number) {
  const start = startOfCalendar(weeks);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    keys.push(dateKey(cursor));
  }
  return keys;
}

function formatTokens(value: number, language: Language) {
  const locale = language === "zh" ? "zh-CN" : "en-US";
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
  }
  return new Intl.NumberFormat(locale).format(value);
}

function mixColor(color: string, target: number, weight: number) {
  const normalized = normalizeThemeColor(color);
  const source = [1, 3, 5].map((index) => parseInt(normalized.slice(index, index + 2), 16));
  return `#${source.map((channel) => Math.round(channel + (target - channel) * weight)
    .toString(16).padStart(2, "0")).join("")}`;
}

function chartPalette(themeColor: string) {
  const color = normalizeThemeColor(themeColor);
  return {
    heat: [
      "#edf1ee",
      mixColor(color, 255, .78),
      mixColor(color, 255, .52),
      mixColor(color, 255, .25),
      mixColor(color, 0, .18),
    ],
    series: [
      color,
      mixColor(color, 0, .22),
      mixColor(color, 255, .28),
      mixColor(color, 0, .42),
      mixColor(color, 255, .5),
    ],
  };
}

function entryTotal(entry: TokenUsageEntry) {
  return entry.totalTokens ?? (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
}

function aggregateEntries(entries: TokenUsageEntry[], label: (entry: TokenUsageEntry) => string) {
  const totals = new Map<string, number>();
  entries.forEach((entry) => {
    const key = label(entry).trim();
    if (!key) return;
    totals.set(key, (totals.get(key) ?? 0) + entryTotal(entry));
  });
  return [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, MAX_RANKING_ITEMS);
}

function EChart({ option, label, className = "" }: {
  option: EChartsOption;
  label: string;
  className?: string;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const chart = init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return <div ref={elementRef} className={`token-echart ${className}`} role="img" aria-label={label} />;
}

function rankingOption(data: Array<[string, number]>, color: string, language: Language): EChartsOption {
  const sorted = [...data].reverse();
  return {
    animationDurationUpdate: 280,
    aria: { enabled: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens`,
    },
    grid: { left: 18, right: 26, top: 12, bottom: 16, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { color: "#7b8980", formatter: (value: number) => formatTokens(value, language) },
      splitLine: { lineStyle: { color: "#e8ede8" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map(([label]) => label),
      axisLabel: { color: "#526158", width: 118, overflow: "truncate" },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [{
      type: "bar",
      data: sorted.map(([, value]) => value),
      barMaxWidth: 14,
      itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: "#718078", formatter: (params: any) => formatTokens(Number(params.value), language) },
    }],
  };
}

function usagePieOption(data: Array<[string, number]>, colors: string[], language: Language): EChartsOption {
  return {
    animationDurationUpdate: 280,
    aria: { enabled: true },
    color: colors,
    tooltip: {
      trigger: "item",
      formatter: (params: any) => `${params.marker}${params.name}<br/><b>${formatTokens(Number(params.value), language)} Tokens</b> · ${params.percent}%`,
    },
    series: [{
      type: "pie",
      radius: ["36%", "66%"],
      center: ["50%", "48%"],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 },
      label: {
        color: "#526158",
        fontSize: 9,
        width: 82,
        overflow: "truncate",
        formatter: "{b}\n{d}%",
      },
      labelLine: { length: 8, length2: 5 },
      data: data.map(([name, value]) => ({ name, value })),
    }],
  };
}

export function TokenUsageDashboard({
  language,
  themeColor,
  weeks,
  refreshSeconds,
  onWeeksChange,
  preferencesLoading = false,
  embedded = false,
}: {
  language: Language;
  themeColor: string;
  weeks: number;
  refreshSeconds: number;
  onWeeksChange?: (value: number | null) => void;
  preferencesLoading?: boolean;
  embedded?: boolean;
}) {
  const [entries, setEntries] = useState<TokenUsageEntry[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyTokenUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const startTs = Math.floor(startOfCalendar(weeks).getTime() / 1000);
      const [nextEntries, nextDailyUsage] = await Promise.all([
        loadTokenUsageEntries(),
        loadDailyTokenUsage(startTs),
      ]);
      if (!mountedRef.current) return;
      setEntries(nextEntries);
      setDailyUsage(nextDailyUsage);
      setUpdatedAt(new Date());
      setError(null);
    } catch (nextError) {
      if (mountedRef.current) setError(String(nextError));
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [weeks]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [load, refreshSeconds]);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const labels = language === "zh" ? {
    eyebrow: "PROVIDER / TOKEN",
    title: "Token 消耗汇总",
    period: `最近 ${weeks} 周`,
    refresh: "刷新",
    updated: "更新于",
    heatmap: "每日 Token 热力图",
    heatmapHint: "颜色越深表示当天 Token 消耗越多，100M 及以上为最深色",
    trend: "每日 Token 趋势",
    breakdown: "Token 类型累计",
    providers: "Provider 消耗排行",
    models: "模型消耗排行",
    accounts: "账户消耗排行",
    recent: `排行基于最近 ${entries.length} 条代理请求`,
    noData: "暂无 Token 数据",
  } : {
    eyebrow: "PROVIDER / TOKEN",
    title: "Token Usage Summary",
    period: `Last ${weeks} weeks`,
    refresh: "Refresh",
    updated: "Updated",
    heatmap: "Daily Token Heatmap",
    heatmapHint: "Darker cells indicate higher daily usage; 100M or more uses the darkest level",
    trend: "Daily Token Trend",
    breakdown: "Token Type Totals",
    providers: "Provider Usage Ranking",
    models: "Model Usage Ranking",
    accounts: "Account Usage Ranking",
    recent: `Rankings use the latest ${entries.length} proxy requests`,
    noData: "No token data",
  };
  const tokenLabels = language === "zh"
    ? { total: "总计", input: "输入", output: "输出", reasoning: "推理", cached: "缓存" }
    : { total: "Total", input: "Input", output: "Output", reasoning: "Reasoning", cached: "Cached" };
  const proxyOnlyHint = language === "zh"
    ? "仅代理模式会统计 Token 消耗"
    : "Token usage is collected only in proxy mode";
  const rangeLabel = language === "zh" ? "最近" : "Last";
  const weeksUnit = language === "zh" ? "周" : "weeks";
  const palette = useMemo(() => chartPalette(themeColor), [themeColor]);
  const dateKeys = useMemo(() => calendarDateKeys(weeks), [dailyUsage, weeks]);
  const dailyByDate = useMemo(() => new Map(dailyUsage.map((entry) => [entry.date, entry])), [dailyUsage]);

  const heatmapOption = useMemo<EChartsOption>(() => ({
    animationDurationUpdate: 280,
    aria: { enabled: true },
    tooltip: {
      formatter: (params: any) => {
        const key = String(params.value?.[0] ?? "");
        const usage = dailyByDate.get(key);
        const date = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", weekday: "short" })
          .format(dateFromKey(key));
        const row = (label: string, value: number) => `<div><span>${label}</span><b>${formatTokens(value, language)}</b></div>`;
        return `<section class="token-chart-tooltip"><strong>${date}</strong>${row(tokenLabels.total, usage?.totalTokens ?? 0)}${row(tokenLabels.input, usage?.inputTokens ?? 0)}${row(tokenLabels.output, usage?.outputTokens ?? 0)}${row(tokenLabels.reasoning, usage?.reasoningTokens ?? 0)}${row(tokenLabels.cached, usage?.cachedTokens ?? 0)}</section>`;
      },
    },
    visualMap: {
      type: "piecewise",
      orient: "horizontal",
      right: 18,
      top: 0,
      itemWidth: 11,
      itemHeight: 11,
      itemGap: 4,
      text: language === "zh" ? ["多", "少"] : ["More", "Less"],
      textStyle: { color: "#718078", fontSize: 10 },
      pieces: [
        { value: 0, color: palette.heat[0] },
        { min: 1, max: 25_000_000, color: palette.heat[1] },
        { min: 25_000_001, max: 50_000_000, color: palette.heat[2] },
        { min: 50_000_001, max: 75_000_000, color: palette.heat[3] },
        { min: 75_000_001, color: palette.heat[4] },
      ],
    },
    calendar: {
      range: [dateKeys[0], dateKeys[dateKeys.length - 1]],
      left: "center",
      top: 44,
      bottom: 18,
      cellSize: [22, 22],
      splitLine: { show: false },
      itemStyle: { color: palette.heat[0], borderColor: "#f8faf8", borderWidth: 2 },
      yearLabel: { show: false },
      monthLabel: { color: "#718078", fontSize: 10, nameMap: language === "zh" ? "ZH" : "EN" },
      dayLabel: { firstDay: 0, color: "#718078", fontSize: 10, nameMap: language === "zh" ? ["日", "一", "二", "三", "四", "五", "六"] : "EN" },
    },
    series: [{
      type: "heatmap",
      coordinateSystem: "calendar",
      data: dateKeys.map((key) => [key, dailyByDate.get(key)?.totalTokens ?? 0]),
    }],
  }), [dailyByDate, dateKeys, language, locale, palette.heat, tokenLabels]);

  const trendOption = useMemo<EChartsOption>(() => {
    const definitions = [
      [tokenLabels.total, "totalTokens"],
      [tokenLabels.input, "inputTokens"],
      [tokenLabels.output, "outputTokens"],
      [tokenLabels.reasoning, "reasoningTokens"],
      [tokenLabels.cached, "cachedTokens"],
    ] as const;
    return {
      animationDurationUpdate: 280,
      aria: { enabled: true },
      color: palette.series,
      tooltip: { trigger: "axis", valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
      legend: { top: 0, textStyle: { color: "#5f6e65", fontSize: 10 } },
      grid: { left: 18, right: 22, top: 38, bottom: 18, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dateKeys,
        axisLabel: { color: "#7b8980", hideOverlap: true, formatter: (value: string) => value.slice(5) },
        axisLine: { lineStyle: { color: "#dfe5df" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#7b8980", formatter: (value: number) => formatTokens(value, language) },
        splitLine: { lineStyle: { color: "#e8ede8" } },
      },
      series: definitions.map(([name, field], index) => ({
        name,
        type: "line",
        smooth: .25,
        showSymbol: false,
        lineStyle: { width: index === 0 ? 2.5 : 1.5 },
        areaStyle: index === 0 ? { opacity: .08 } : undefined,
        data: dateKeys.map((key) => dailyByDate.get(key)?.[field] ?? 0),
      })),
    };
  }, [dailyByDate, dateKeys, language, palette.series, tokenLabels]);

  const breakdownOption = useMemo<EChartsOption>(() => {
    const totals = dailyUsage.reduce((current, entry) => ({
      input: current.input + entry.inputTokens,
      output: current.output + entry.outputTokens,
      reasoning: current.reasoning + entry.reasoningTokens,
      cached: current.cached + entry.cachedTokens,
    }), { input: 0, output: 0, reasoning: 0, cached: 0 });
    return {
      animationDurationUpdate: 280,
      aria: { enabled: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
      grid: { left: 16, right: 18, top: 16, bottom: 18, containLabel: true },
      xAxis: { type: "category", data: [tokenLabels.input, tokenLabels.output, tokenLabels.reasoning, tokenLabels.cached], axisTick: { show: false }, axisLine: { lineStyle: { color: "#dfe5df" } }, axisLabel: { color: "#5f6e65" } },
      yAxis: { type: "value", axisLabel: { color: "#7b8980", formatter: (value: number) => formatTokens(value, language) }, splitLine: { lineStyle: { color: "#e8ede8" } } },
      series: [{ type: "bar", data: [totals.input, totals.output, totals.reasoning, totals.cached], barMaxWidth: 30, itemStyle: { color: (params: any) => palette.series[params.dataIndex], borderRadius: [4, 4, 0, 0] }, label: { show: true, position: "top", color: "#718078", formatter: (params: any) => formatTokens(Number(params.value), language) } }],
    };
  }, [dailyUsage, language, palette.series, tokenLabels]);

  const providerData = useMemo(() => aggregateEntries(entries, (entry) => entry.provider), [entries]);
  const modelData = useMemo(() => aggregateEntries(entries, (entry) => entry.model), [entries]);
  const accountData = useMemo(() => aggregateEntries(entries, (entry) => entry.accountEmail?.trim()
    || entry.accountId?.trim()
    || (language === "zh" ? "未识别账户" : "Unknown account")), [entries, language]);

  return (
    <div className={`token-dashboard${embedded ? " embedded" : ""}`}>
      <header className="token-dashboard-header">
        <div>
          <span>{labels.eyebrow}</span>
          <h1>{labels.title}</h1>
          <small>{labels.period}{updatedAt ? ` · ${labels.updated} ${updatedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}<span className="token-dashboard-proxy-note"> · {proxyOnlyHint}</span></small>
        </div>
        <div className="token-dashboard-actions">
          <label className="token-dashboard-range">
            <span>{rangeLabel}</span>
            <InputNumber min={MIN_TOKEN_USAGE_WEEKS} max={MAX_TOKEN_USAGE_WEEKS} step={1}
              value={weeks} disabled={preferencesLoading || !onWeeksChange}
              onChange={(value) => onWeeksChange?.(value)} aria-label={`${rangeLabel} ${weeksUnit}`} />
            <span>{weeksUnit}</span>
          </label>
          <Button icon={<RefreshCw className={loading ? "spin" : ""} size={15} />} onClick={() => void load()} disabled={loading}>
            {labels.refresh}
          </Button>
        </div>
      </header>
      {error ? <div className="token-usage-error">{error}</div> : null}
      <div className="token-dashboard-grid token-dashboard-grid-top">
        <section className="token-chart-panel token-chart-panel-heatmap">
          <div className="token-chart-heading"><h2>{labels.heatmap}</h2><span>{labels.heatmapHint}</span></div>
          <EChart option={heatmapOption} label={labels.heatmap} className="token-echart-heatmap" />
        </section>
        <section className="token-chart-panel">
          <div className="token-chart-heading"><h2>{labels.trend}</h2><span>{labels.period}</span></div>
          <EChart option={trendOption} label={labels.trend} className="token-echart-trend" />
        </section>
      </div>
      <div className="token-dashboard-grid token-dashboard-grid-bottom">
        <section className="token-chart-panel">
          <div className="token-chart-heading"><h2>{labels.breakdown}</h2><span>{labels.period}</span></div>
          <EChart option={breakdownOption} label={labels.breakdown} />
        </section>
        <section className="token-chart-panel">
          <div className="token-chart-heading"><h2>{labels.providers}</h2><span>{labels.recent}</span></div>
          <EChart option={rankingOption(providerData, palette.series[0], language)} label={labels.providers} />
        </section>
        <section className="token-chart-panel">
          <div className="token-chart-heading"><h2>{labels.models}</h2><span>{labels.recent}</span></div>
          <EChart option={usagePieOption(modelData, palette.series, language)} label={labels.models} />
        </section>
        <section className="token-chart-panel">
          <div className="token-chart-heading"><h2>{labels.accounts}</h2><span>{labels.recent}</span></div>
          <EChart option={usagePieOption(accountData, palette.series, language)} label={labels.accounts} />
        </section>
      </div>
      {!loading && dailyUsage.length === 0 && entries.length === 0 ? <div className="token-dashboard-empty">{labels.noData}</div> : null}
    </div>
  );
}
