export const HOUR_MS = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;

export interface TrafficRow {
  hourStart: Date | string | null;
  bytes: string;
}

export function trafficRange(days: number, now = new Date()) {
  const today = Math.floor((now.getTime() + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
  return { start: new Date(today - (days - 1) * DAY_MS), until: new Date(today + DAY_MS) };
}

/** Build complete Beijing calendar days, including hours with no forwarded data. */
export function summarizeTraffic(rows: TrafficRow[], range: ReturnType<typeof trafficRange>) {
  const hours = new Map(rows.filter((row) => row.hourStart !== null)
    .map((row) => [new Date(row.hourStart!).getTime(), Number(row.bytes)]));
  const dayCount = (range.until.getTime() - range.start.getTime()) / DAY_MS;
  const daily = Array.from({ length: dayCount }, (_, day) => {
    const start = range.start.getTime() + day * DAY_MS;
    const hourlyBytes = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hours.get(start + hour * HOUR_MS) ?? 0);
    return {
      date: new Date(start + BEIJING_OFFSET_MS).toISOString().slice(0, 10),
      bytes: hourlyBytes.reduce((total, bytes) => total + bytes, 0),
      hourlyBytes,
    };
  });
  return { totalBytes: Number(rows.find((row) => row.hourStart === null)?.bytes ?? 0), daily };
}
