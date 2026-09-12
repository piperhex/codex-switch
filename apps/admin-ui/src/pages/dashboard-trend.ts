import type { EChartsCoreOption } from "echarts/core";
import type { Translate } from "../i18n";
import type { DashboardOverview, TelemetryPlatform } from "../types";

export const dashboardPlatforms: Array<{ name: TelemetryPlatform; label: string; color: string }> = [
  { name: "windows", label: "Windows", color: "#1769e0" },
  { name: "macos", label: "macOS", color: "#7c3aed" },
  { name: "linux", label: "Linux", color: "#f59e0b" },
  { name: "android", label: "Android", color: "#16a085" },
  { name: "ios", label: "iOS", color: "#06b6d4" },
];

function trendSeries(trend: DashboardOverview["trend"], t: Translate) {
  const line = { type: "line", showSymbol: false, lineStyle: { width: 2 } };
  return [
    { ...line, name: t("dashboard.newUsers"), color: "#e879a8", data: trend.map((item) => item.users) },
    { ...line, name: t("dashboard.newDevices"), color: "#64748b", data: trend.map((item) => item.installations) },
    ...dashboardPlatforms.map((platform) => ({
      ...line,
      name: t("dashboard.newPlatformDevices", { platform: platform.label }),
      color: platform.color,
      data: trend.map((item) => item.platforms?.find((entry) => entry.name === platform.name)?.value ?? 0),
    })),
    {
      ...line, name: t("dashboard.totalDevices"), color: "#d97706", yAxisIndex: 1,
      lineStyle: { width: 3, type: "dashed" },
      data: trend.map((item) => item.totalInstallations ?? null),
    },
  ];
}

export function dashboardTrendOption(options: {
  trend: DashboardOverview["trend"];
  dateLabels: string[];
  muted: string;
  gridLine: string;
  t: Translate;
}): EChartsCoreOption {
  const { trend, dateLabels, muted, gridLine, t } = options;
  const axis = { type: "value", minInterval: 1, axisLabel: { color: muted }, nameTextStyle: { color: muted } };
  return {
    animationDuration: 450,
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", confine: true, extraCssText: "max-width:400px;white-space:normal;" },
    legend: { type: "scroll", top: 0, left: 4, right: 4, textStyle: { color: muted } },
    grid: { left: 18, right: 18, top: 70, bottom: 8, containLabel: true },
    xAxis: {
      type: "category", boundaryGap: false, data: dateLabels,
      axisLine: { lineStyle: { color: gridLine } }, axisTick: { show: false },
      axisLabel: { color: muted, hideOverlap: true },
    },
    yAxis: [
      { ...axis, name: t("dashboard.dailyNew"), splitLine: { lineStyle: { color: gridLine } } },
      { ...axis, name: t("dashboard.totalDevices"), splitLine: { show: false } },
    ],
    series: trendSeries(trend, t),
  };
}
