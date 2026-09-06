import type { AccountQuotaHistory } from "../../types/tokenUsageAnalytics";

export type QuotaInterval = "hour" | "sixHours" | "day";
export type QuotaView = "drop" | "remaining";
export type QuotaSeriesPoint = [number, number | null];
type QuotaPoint = AccountQuotaHistory["points"][number];
type QuotaWindow = "primary" | "secondary";

export interface QuotaChartData {
  primary: QuotaSeriesPoint[];
  secondary: QuotaSeriesPoint[];
  hasData: boolean;
  observedRange: { startTs: number; endTs: number } | null;
}

export interface QuotaDataOptions {
  points: QuotaPoint[];
  startTs: number;
  endTs: number;
  interval: QuotaInterval;
  view: QuotaView;
}

const HOUR_SECONDS = 3_600;
const INTERVAL_HOURS: Record<QuotaInterval, number> = { hour: 1, sixHours: 6, day: 24 };
const PERCENT_SCALE = 1_000;

function bucketStart(ts: number, interval: QuotaInterval) {
  const date = new Date(ts * 1_000);
  const hours = INTERVAL_HOURS[interval];
  date.setHours(Math.floor(date.getHours() / hours) * hours, 0, 0, 0);
  return date.getTime() / 1_000;
}

function nextBucket(ts: number, interval: QuotaInterval) {
  const date = new Date(ts * 1_000);
  date.setHours(date.getHours() + INTERVAL_HOURS[interval]);
  return date.getTime() / 1_000;
}

function remaining(point: QuotaPoint, window: QuotaWindow) {
  const value = window === "primary" ? point.primaryRemainingPercent : point.secondaryRemainingPercent;
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function resetAt(point: QuotaPoint, window: QuotaWindow) {
  return window === "primary" ? point.primaryResetAt : point.secondaryResetAt;
}

function isContinuous(options: {
  previous: QuotaPoint;
  current: QuotaPoint;
  window: QuotaWindow;
  interval: QuotaInterval;
}) {
  const { previous, current, window, interval } = options;
  const elapsed = current.ts - previous.ts;
  if (elapsed <= 0 || elapsed > INTERVAL_HOURS[interval] * HOUR_SECONDS) return false;
  const previousReset = resetAt(previous, window);
  if (previousReset !== resetAt(current, window)) return false;
  if (previousReset !== null && previousReset > previous.ts && previousReset <= current.ts) return false;
  const previousValue = remaining(previous, window);
  const currentValue = remaining(current, window);
  return previousValue !== null && currentValue !== null && currentValue <= previousValue;
}

function createBuckets(options: QuotaDataOptions) {
  const buckets = new Map<number, number | null>();
  for (let ts = bucketStart(options.startTs, options.interval); ts <= options.endTs;
    ts = nextBucket(ts, options.interval)) {
    buckets.set(ts, null);
  }
  return buckets;
}

function declineSeries(options: QuotaDataOptions, window: QuotaWindow) {
  const buckets = createBuckets(options);
  options.points.forEach((point, index) => {
    const previous = options.points[index - 1];
    if (!previous || point.ts < options.startTs || point.ts > options.endTs) return;
    if (!isContinuous({ previous, current: point, window, interval: options.interval })) return;
    const ts = bucketStart(point.ts, options.interval);
    const drop = (remaining(previous, window) ?? 0) - (remaining(point, window) ?? 0);
    // A delta belongs to the observation time; empty periods are never imputed as zero.
    const value = (buckets.get(ts) ?? 0) + drop;
    buckets.set(ts, Math.round(value * PERCENT_SCALE) / PERCENT_SCALE);
  });
  return [...buckets].map(([ts, value]): QuotaSeriesPoint => [ts * 1_000, value]);
}

function remainingSeries(options: QuotaDataOptions, window: QuotaWindow) {
  const series: QuotaSeriesPoint[] = [];
  options.points.forEach((point, index) => {
    if (point.ts < options.startTs || point.ts > options.endTs) return;
    const previous = options.points[index - 1];
    if (previous && previous.ts >= options.startTs
      && !isContinuous({ previous, current: point, window, interval: options.interval })) {
      // Keep both observed endpoints while preventing a line across resets or gaps.
      series.push([(previous.ts + point.ts) * 500, null]);
    }
    series.push([point.ts * 1_000, remaining(point, window)]);
  });
  return series;
}

function observedRange(options: QuotaDataOptions) {
  const visible = options.points.filter((point) => point.ts >= options.startTs && point.ts <= options.endTs
    && (remaining(point, "primary") !== null || remaining(point, "secondary") !== null));
  return visible.length ? { startTs: visible[0].ts, endTs: visible[visible.length - 1].ts } : null;
}

export function buildQuotaChartData(options: QuotaDataOptions): QuotaChartData {
  if (!Number.isFinite(options.startTs) || !Number.isFinite(options.endTs) || options.endTs < options.startTs) {
    return { primary: [], secondary: [], hasData: false, observedRange: null };
  }
  const byTime = new Map(options.points.filter((point) => Number.isFinite(point.ts))
    .map((point) => [point.ts, point]));
  const ordered = { ...options, points: [...byTime.values()].sort((left, right) => left.ts - right.ts) };
  const buildSeries = options.view === "drop" ? declineSeries : remainingSeries;
  const primary = buildSeries(ordered, "primary");
  const secondary = buildSeries(ordered, "secondary");
  const hasData = [...primary, ...secondary].some(([, value]) => value !== null);
  return { primary, secondary, hasData, observedRange: observedRange(ordered) };
}
