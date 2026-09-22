import type { EChartsCoreOption } from "echarts/core";
import type { Language } from "../i18n";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
const UNIT_SIZE = 1024;

export function formatTrafficBytes(bytes: number, language: Language): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const unit = Math.min(Math.floor(Math.log(Math.max(1, safeBytes)) / Math.log(UNIT_SIZE)), BYTE_UNITS.length - 1);
  const value = new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: unit === 0 ? 0 : 2,
  }).format(safeBytes / UNIT_SIZE ** unit);
  return `${value} ${BYTE_UNITS[unit]}`;
}

export function chatTrafficChart(options: {
  labels: string[];
  bytes: number[];
  title: string;
  dark: boolean;
  language: Language;
}): EChartsCoreOption {
  const { labels, bytes, title, dark, language } = options;
  const muted = dark ? "#8fa0b5" : "#64748b";
  const gridLine = dark ? "rgba(148, 163, 184, 0.12)" : "rgba(148, 163, 184, 0.18)";
  return {
    animationDuration: 300,
    backgroundColor: "transparent",
    color: ["#1769e0"],
    tooltip: {
      trigger: "axis", confine: true,
      extraCssText: "max-width:400px;white-space:normal;overflow-wrap:anywhere;",
      valueFormatter: (value: unknown) => formatTrafficBytes(Number(value), language),
    },
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category", data: labels,
      axisLine: { lineStyle: { color: gridLine } }, axisTick: { show: false },
      axisLabel: { color: muted, hideOverlap: true, formatter: (label: string) => label.slice(-5) },
    },
    yAxis: {
      type: "value", minInterval: 1,
      axisLabel: { color: muted, formatter: (value: number) => formatTrafficBytes(value, language) },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: [{ name: title, type: "bar", data: bytes, barMaxWidth: 24, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
  };
}
