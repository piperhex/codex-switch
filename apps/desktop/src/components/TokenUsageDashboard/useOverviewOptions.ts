import { useMemo } from "react";
import type { EChartsCoreOption as EChartsOption } from "echarts/core";
import type { Language } from "../../i18n";
import type { DailyTokenUsage } from "../../types";
import { COMPACT_TOOLTIP_STYLE, dateFromKey, formatTokens, type ChartPalette } from "./chartUtils";

interface OverviewOptions {
  dailyUsage: DailyTokenUsage[];
  dateKeys: string[];
  language: Language;
  palette: ChartPalette;
}

interface OverviewContext extends OverviewOptions {
  locale: string;
  tokenLabels: { total: string; input: string; output: string; reasoning: string; cached: string };
  dailyByDate: Map<string, DailyTokenUsage>;
}

function heatmapTooltip(context: OverviewContext, key: string) {
  const { dailyByDate, locale, language, tokenLabels } = context;
  const usage = dailyByDate.get(key);
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(dateFromKey(key));
  const row = (label: string, value: number) => (
    `<div><span>${label}</span><b>${formatTokens(value, language)}</b></div>`
  );
  const rows = [row(tokenLabels.total, usage?.totalTokens ?? 0),
    row(tokenLabels.input, usage?.inputTokens ?? 0), row(tokenLabels.output, usage?.outputTokens ?? 0),
    row(tokenLabels.reasoning, usage?.reasoningTokens ?? 0), row(tokenLabels.cached, usage?.cachedTokens ?? 0)];
  return `<section class="token-chart-tooltip"><strong>${date}</strong>${rows.join("")}</section>`;
}

function useHeatmapOption(context: OverviewContext) {
  const { dailyByDate, dateKeys, language, locale, palette, tokenLabels } = context;
  const heatmapOption = useMemo<EChartsOption>(() => ({
    animationDurationUpdate: 280,
    aria: { enabled: true },
    tooltip: { confine: true, extraCssText: COMPACT_TOOLTIP_STYLE,
      formatter: (params: { value?: [string, number] }) => heatmapTooltip(context, String(params.value?.[0] ?? "")),
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
      textStyle: { color: palette.muted, fontSize: 10 },
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
      itemStyle: { color: palette.heat[0], borderColor: palette.panel, borderWidth: 2 },
      yearLabel: { show: false },
      monthLabel: { color: palette.muted, fontSize: 10,
        nameMap: language === "zh" ? "ZH" : "EN" },
      dayLabel: { firstDay: 0, color: palette.muted, fontSize: 10,
        nameMap: language === "zh" ? ["日", "一", "二", "三", "四", "五", "六"] : "EN" },
    },
    series: [{
      type: "heatmap",
      coordinateSystem: "calendar",
      data: dateKeys.map((key) => [key, dailyByDate.get(key)?.totalTokens ?? 0]),
    }],
  }), [dailyByDate, dateKeys, language, locale, palette, tokenLabels]);

  return heatmapOption;
}

function useTrendOption(context: OverviewContext) {
  const { dailyByDate, dateKeys, language, palette, tokenLabels } = context;
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
      tooltip: { confine: true, extraCssText: COMPACT_TOOLTIP_STYLE, trigger: "axis",
        valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
      legend: { top: 0, textStyle: { color: palette.text, fontSize: 10 } },
      grid: { left: 18, right: 22, top: 38, bottom: 18, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dateKeys,
        axisLabel: { color: palette.muted, hideOverlap: true,
          formatter: (value: string) => value.slice(5) },
        axisLine: { lineStyle: { color: palette.grid } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: palette.muted, formatter: (value: number) => formatTokens(value, language) },
        splitLine: { lineStyle: { color: palette.grid } },
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
  }, [dailyByDate, dateKeys, language, palette, tokenLabels]);

  return trendOption;
}

function useTokenTypeOption(context: OverviewContext) {
  const { dailyUsage, language, palette, tokenLabels } = context;
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
      tooltip: { confine: true, extraCssText: COMPACT_TOOLTIP_STYLE, trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
      grid: { left: 16, right: 18, top: 16, bottom: 18, containLabel: true },
      xAxis: { type: "category",
        data: [tokenLabels.input, tokenLabels.output, tokenLabels.reasoning, tokenLabels.cached],
        axisTick: { show: false }, axisLine: { lineStyle: { color: palette.grid } },
        axisLabel: { color: palette.text } },
      yAxis: { type: "value",
        axisLabel: { color: palette.muted, formatter: (value: number) => formatTokens(value, language) },
        splitLine: { lineStyle: { color: palette.grid } } },
      series: [{ type: "bar", data: [totals.input, totals.output, totals.reasoning, totals.cached],
        barMaxWidth: 30,
        itemStyle: { color: (params: { dataIndex: number }) => palette.series[params.dataIndex],
          borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: palette.muted,
          formatter: (params: { value: number }) => formatTokens(Number(params.value), language) } }],
    };
  }, [dailyUsage, language, palette, tokenLabels]);

  return breakdownOption;
}

export function useOverviewOptions(options: OverviewOptions) {
  const { dailyUsage, language } = options;
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const tokenLabels = useMemo(() => language === "zh"
    ? { total: "总计", input: "输入", output: "输出", reasoning: "推理", cached: "缓存" }
    : { total: "Total", input: "Input", output: "Output", reasoning: "Reasoning", cached: "Cached" }, [language]);
  const dailyByDate = useMemo(() => new Map(dailyUsage.map((entry) => [entry.date, entry])), [dailyUsage]);
  const context = { ...options, locale, tokenLabels, dailyByDate };
  const heatmapOption = useHeatmapOption(context);
  const trendOption = useTrendOption(context);
  const breakdownOption = useTokenTypeOption(context);
  return { heatmapOption, trendOption, breakdownOption };
}
