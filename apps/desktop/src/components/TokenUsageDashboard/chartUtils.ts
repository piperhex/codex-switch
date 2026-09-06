import type { EChartsCoreOption as EChartsOption } from "echarts/core";
import type { Language } from "../../i18n";
import type { TokenUsageEntry } from "../../types";
import { normalizeThemeColor } from "../../utils/theme";

const MAX_RANKING_ITEMS = 8;
export const COMPACT_TOOLTIP_STYLE = "max-width:400px;white-space:normal;overflow-wrap:anywhere";
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

export function dateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}

export function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

export function startOfCalendar(weeks: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
  return start;
}

export function calendarDateKeys(weeks: number) {
  const start = startOfCalendar(weeks);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    keys.push(dateKey(cursor));
  }
  return keys;
}

export function formatTokens(value: number, language: Language) {
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

export interface ChartPalette {
  grid: string;
  heat: string[];
  panel: string;
  series: string[];
  text: string;
  muted: string;
}

export function chartPalette(themeColor: string, dark: boolean): ChartPalette {
  const color = normalizeThemeColor(themeColor);
  return {
    heat: [
      dark ? "#252d28" : "#edf1ee",
      mixColor(color, dark ? 24 : 255, dark ? .72 : .78),
      mixColor(color, dark ? 24 : 255, dark ? .5 : .52),
      mixColor(color, dark ? 24 : 255, dark ? .28 : .25),
      mixColor(color, 0, .18),
    ],
    series: [
      color,
      mixColor(color, 0, .22),
      mixColor(color, 255, .28),
      mixColor(color, 0, .42),
      mixColor(color, 255, .5),
    ],
    grid: dark ? "#39453e" : "#e8ede8",
    panel: dark ? "#1e2521" : "#fff",
    text: dark ? "#b7c2bb" : "#526158",
    muted: dark ? "#8f9c94" : "#718078",
  };
}

function entryTotal(entry: TokenUsageEntry) {
  return entry.totalTokens ?? (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
}

export function aggregateEntries(entries: TokenUsageEntry[], label: (entry: TokenUsageEntry) => string) {
  const totals = new Map<string, number>();
  entries.forEach((entry) => {
    const key = label(entry).trim();
    if (!key) return;
    totals.set(key, (totals.get(key) ?? 0) + entryTotal(entry));
  });
  return [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, MAX_RANKING_ITEMS);
}

export function usagePieOption(
  data: Array<[string, number]>,
  palette: ChartPalette,
  language: Language,
): EChartsOption {
  return {
    animationDurationUpdate: 280,
    aria: { enabled: true },
    color: palette.series,
    tooltip: {
      trigger: "item", confine: true, extraCssText: COMPACT_TOOLTIP_STYLE,
      formatter: (params: { marker?: string; name: string; value: number; percent?: number }) => (
        `${params.marker ?? ""}${escapeHtml(params.name)}<br/>`
        + `<b>${formatTokens(Number(params.value), language)} Tokens</b> · ${params.percent}%`
      ),
    },
    series: [{
      type: "pie",
      radius: ["36%", "66%"],
      center: ["50%", "48%"],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: palette.panel, borderWidth: 2, borderRadius: 3 },
      label: {
        color: palette.text,
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
