import type { EChartsCoreOption } from "echarts/core";
import type { Language } from "../i18n";

export interface ServerBandwidth {
  sampledAt: string;
  startedAt: string;
  bytesPerSecond: number;
  peakBytesPerSecond: number;
  recentBytes: number;
  totalBytes: number;
  history: Array<{ time: string; bytesPerSecond: number }>;
}

const BYTE_UNITS = ["B", "KB", "MB"];
const UNIT_SIZE = 1024;

export function formatBandwidthBytes(bytes: number, language: Language): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const unit = Math.min(Math.floor(Math.log(Math.max(1, safeBytes)) / Math.log(UNIT_SIZE)), BYTE_UNITS.length - 1);
  const value = new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: unit === 0 ? 0 : 2,
  }).format(safeBytes / UNIT_SIZE ** unit);
  return `${value} ${BYTE_UNITS[unit]}`;
}

export function serverBandwidthChart(options: {
  history: ServerBandwidth["history"];
  language: Language;
  dark: boolean;
  title: string;
}): EChartsCoreOption {
  const { history, language, dark, title } = options;
  const muted = dark ? "#8fa0b5" : "#64748b";
  const gridLine = dark ? "rgba(148, 163, 184, 0.12)" : "rgba(148, 163, 184, 0.18)";
  const time = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const rate = (value: number) => `${formatBandwidthBytes(value, language)}/s`;
  return {
    animation: false,
    backgroundColor: "transparent",
    color: ["#1769e0"],
    tooltip: {
      trigger: "axis", confine: true,
      extraCssText: "max-width:400px;white-space:normal;overflow-wrap:anywhere;",
      valueFormatter: (value: unknown) => rate(Number(value)),
    },
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    xAxis: {
      type: "category", boundaryGap: false,
      data: history.map((sample) => time.format(new Date(sample.time))),
      axisLine: { lineStyle: { color: gridLine } }, axisTick: { show: false },
      axisLabel: { color: muted, hideOverlap: true },
    },
    yAxis: {
      type: "value", minInterval: 1,
      axisLabel: { color: muted, formatter: rate },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: [{
      name: title, type: "line", showSymbol: false,
      data: history.map((sample) => sample.bytesPerSecond),
      lineStyle: { width: 2 }, areaStyle: { opacity: 0.12 },
    }],
  };
}
