import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";
import type { Language } from "../../i18n";
import type { DailyTokenUsageBreakdown } from "../../types/tokenUsageAnalytics";
import { COMPACT_TOOLTIP_STYLE, formatTokens, type ChartPalette } from "./chartUtils";
import { EChart } from "./EChart";
import styles from "./index.module.less";

type ConsumptionField = Exclude<keyof DailyTokenUsageBreakdown, "date">;
interface SeriesDefinition { name: string; field: ConsumptionField }
interface ConsumptionProps {
  daily: DailyTokenUsageBreakdown[];
  dateKeys: string[];
  language: Language;
  palette: ChartPalette;
  thresholdTokens: number;
  loading: boolean;
  error: boolean;
}

function consumptionOption(options: {
  props: ConsumptionProps; definitions: SeriesDefinition[];
}): EChartsCoreOption {
  const { props: { daily, dateKeys, palette, language }, definitions } = options;
  const byDate = new Map(daily.map((entry) => [entry.date, entry]));
  return {
    animationDurationUpdate: 280,
    aria: { enabled: true, label: { description: language === "zh"
      ? "每日 Token 消耗堆叠柱状图，可通过图例切换分类。分类累计值和占比显示在图表上方。"
      : "Daily stacked token usage. Use the legend to toggle categories; totals and shares appear above." } },
    color: [palette.series[0], "#cb8b41", palette.muted],
    tooltip: { trigger: "axis", confine: true, extraCssText: COMPACT_TOOLTIP_STYLE,
      axisPointer: { type: "shadow" },
      valueFormatter: (value: unknown) => `${formatTokens(Number(value), language)} Tokens` },
    legend: { top: 4, textStyle: { color: palette.text, fontSize: 11 } },
    grid: { left: 16, right: 20, top: 42, bottom: 12, containLabel: true },
    xAxis: { type: "category", data: dateKeys, axisLabel: { color: palette.muted, hideOverlap: true,
      formatter: (value: string) => value.slice(5) }, axisLine: { lineStyle: { color: palette.grid } } },
    yAxis: { type: "value", axisLabel: { color: palette.muted,
      formatter: (value: number) => formatTokens(value, language) },
      splitLine: { lineStyle: { color: palette.grid } } },
    series: definitions.map(({ name, field }) => ({
      name, type: "bar", stack: "tokens", barMaxWidth: 24,
      emphasis: { focus: "series" }, data: dateKeys.map((key) => byDate.get(key)?.[field] ?? 0),
    })),
  };
}

function ConsumptionPanel({ props, title, hint, definitions }: {
  props: ConsumptionProps; title: string; hint: string; definitions: SeriesDefinition[];
}) {
  const { daily, language, loading, error } = props;
  const option = useMemo(() => consumptionOption({ props, definitions }), [props, definitions]);
  const totals = definitions.map(({ name, field }) => ({
    name, tokens: daily.reduce((sum, entry) => sum + entry[field], 0),
  }));
  const totalTokens = totals.reduce((sum, entry) => sum + entry.tokens, 0);
  return <section className={styles.tokenChartPanel}>
    <div className={styles.tokenChartHeading}><h2>{title}</h2></div>
    <p className={styles.analyticsHint}>{hint}</p>
    {!error ? <div className={styles.consumptionTotals}>
      {totals.map(({ name, tokens }) => <div key={name}>
        <span>{name}</span><strong>{formatTokens(tokens, language)}</strong>
        <small>{totalTokens > 0 ? `${(tokens / totalTokens * 100).toFixed(1)}%` : "—"}</small>
      </div>)}
    </div> : null}
    {error ? <p className={styles.tokenUsageError} role="alert">
      {language === "zh" ? "消耗统计刷新失败，请重试。" : "Could not refresh consumption statistics. Please retry."}
    </p> : null}
    {error ? null : totalTokens > 0 ? <EChart option={option} label={title} />
      : <div className={styles.tokenDashboardEmpty}>
      {loading ? (language === "zh" ? "正在加载…" : "Loading…")
        : (language === "zh" ? "所选时段暂无 Token 消耗记录" : "No token usage in this period")}
    </div>}
  </section>;
}

export function ConsumptionCharts(props: ConsumptionProps) {
  const zh = props.language === "zh";
  const unknown = zh ? "未识别" : "Unknown";
  const threshold = new Intl.NumberFormat(zh ? "zh-CN" : "en-US").format(props.thresholdTokens);
  const contextDefinitions: SeriesDefinition[] = [
    { name: zh ? "短上下文" : "Short context", field: "shortContextTokens" },
    { name: zh ? "长上下文" : "Long context", field: "longContextTokens" },
    { name: unknown, field: "unknownContextTokens" },
  ];
  const modeDefinitions: SeriesDefinition[] = [
    { name: zh ? "普通模式" : "Standard mode", field: "standardModeTokens" },
    { name: zh ? "快速模式" : "Fast mode", field: "fastModeTokens" },
    { name: unknown, field: "unknownModeTokens" },
  ];
  return <div className={`${styles.tokenDashboardGrid} ${styles.consumptionGrid}`}>
    <ConsumptionPanel props={props} definitions={contextDefinitions}
      title={zh ? "短 / 长上下文消耗" : "Short / Long Context Usage"}
      hint={zh ? `单次输入超过 ${threshold} Tokens（含缓存）计为长上下文，累计整次请求的消耗。`
        : `Inputs above ${threshold} tokens (including cache) are long context. Totals include the whole request.`} />
    <ConsumptionPanel props={props} definitions={modeDefinitions}
      title={zh ? "普通 / 快速模式消耗" : "Standard / Fast Mode Usage"}
      hint={zh ? "按每日实际 Token 数统计；缺少模式记录的消耗归入“未识别”。"
        : "Actual tokens per day; usage without a known mode is shown as unknown."} />
  </div>;
}
