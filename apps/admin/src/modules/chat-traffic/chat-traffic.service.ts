import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { HOUR_MS, summarizeTraffic, trafficRange, type TrafficRow } from './chat-traffic-summary';

const FLUSH_INTERVAL_MS = 5000;
const WRITE_TRAFFIC = `
  INSERT INTO chat_relay_traffic (reporter_id, hour_start, bytes)
  SELECT $1::uuid, hour_start, bytes FROM UNNEST($2::timestamptz[], $3::bigint[]) AS bucket(hour_start, bytes)
  ON CONFLICT (hour_start, reporter_id) DO UPDATE
  SET bytes = GREATEST(chat_relay_traffic.bytes, EXCLUDED.bytes)
`;
const READ_TRAFFIC = `
  SELECT NULL::timestamptz AS "hourStart", COALESCE(SUM(bytes), 0)::text AS bytes FROM chat_relay_traffic
  UNION ALL
  SELECT hour_start AS "hourStart", SUM(bytes)::text AS bytes FROM chat_relay_traffic
  WHERE hour_start >= $1 AND hour_start < $2
  GROUP BY hour_start
`;

@Injectable()
export class ChatTrafficService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatTrafficService.name);
  private readonly reporterId = randomUUID();
  // One counter per active hour, independent of the number of frames or sessions.
  private readonly totals = new Map<number, number>();
  private readonly pending = new Set<number>();
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  /** Count each successfully written relay frame once, in either direction. */
  record(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return;
    const hour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    this.totals.set(hour, (this.totals.get(hour) ?? 0) + bytes);
    this.pending.add(hour);
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.pending.size) return Promise.resolve();
    const snapshot = [...this.pending].map((hour) => ({ hour, bytes: this.totals.get(hour)! }));
    this.flushing = this.write(snapshot).finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  private async write(snapshot: Array<{ hour: number; bytes: number }>) {
    try {
      // Absolute counters plus a process-specific reporter make retries idempotent,
      // including a lost database acknowledgement. Different processes add independently.
      await this.dataSource.query(WRITE_TRAFFIC, [
        this.reporterId, snapshot.map(({ hour }) => new Date(hour)), snapshot.map(({ bytes }) => bytes),
      ]);
      for (const { hour, bytes } of snapshot) {
        if (this.totals.get(hour) === bytes) this.pending.delete(hour);
      }
    } catch {
      this.logger.warn('Could not save chat relay traffic; pending counters will be retried.');
    }
  }

  async getOverview(days: 7 | 30 | 90) {
    await this.flush();
    const range = trafficRange(days);
    const rows = await this.dataSource.query<TrafficRow[]>(READ_TRAFFIC, [range.start, range.until]);
    return summarizeTraffic(rows, range);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flushing;
    await this.flush();
  }
}
