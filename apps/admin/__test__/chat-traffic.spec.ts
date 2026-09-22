import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTrafficService } from '@/modules/chat-traffic/chat-traffic.service';
import { summarizeTraffic, trafficRange } from '@/modules/chat-traffic/chat-traffic-summary';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T16:30:00Z')); });
afterEach(() => vi.useRealTimers());

describe('chat relay traffic calendar', () => {
  it.each([7, 30, 90])('fills every day and all 24 hours in a %i-day range', (days) => {
    const range = trafficRange(days);
    const result = summarizeTraffic([], range);
    expect(result.totalBytes).toBe(0);
    expect(result.daily).toHaveLength(days);
    expect(result.daily.at(-1)?.date).toBe('2026-09-23');
    expect(result.daily.every((day) => day.bytes === 0 && day.hourlyBytes.length === 24
      && day.hourlyBytes.every((bytes) => bytes === 0))).toBe(true);
  });

  it('keeps lifetime totals separate and groups hours across Beijing midnight and the year boundary', () => {
    const range = trafficRange(7, new Date('2025-12-31T16:10:00Z'));
    expect(range.start.toISOString()).toBe('2025-12-25T16:00:00.000Z');
    expect(range.until.toISOString()).toBe('2026-01-01T16:00:00.000Z');
    const result = summarizeTraffic([
      { hourStart: null, bytes: '9000000000' },
      { hourStart: '2025-12-31T15:00:00Z', bytes: '20' },
      { hourStart: '2025-12-31T16:00:00Z', bytes: '30' },
      { hourStart: new Date('2025-12-31T17:00:00Z'), bytes: '40' },
      { hourStart: '2026-01-01T16:00:00Z', bytes: '999' },
    ], range);
    expect(result.totalBytes).toBe(9000000000);
    expect(result.daily.at(-2)).toMatchObject({ date: '2025-12-31', bytes: 20 });
    expect(result.daily.at(-2)?.hourlyBytes[23]).toBe(20);
    expect(result.daily.at(-1)).toMatchObject({ date: '2026-01-01', bytes: 70 });
    expect(result.daily.at(-1)?.hourlyBytes.slice(0, 3)).toEqual([30, 40, 0]);
    expect(result.daily.reduce((total, day) => total + day.bytes, 0)).toBe(90);
  });
});

describe('chat relay traffic persistence', () => {
  function setup() {
    const query = vi.fn().mockResolvedValue([]);
    return { query, service: new ChatTrafficService({ query } as unknown as DataSource) };
  }

  it('batches frames by hour without database calls on the relay path', async () => {
    const { query, service } = setup();
    service.record(120);
    service.record(80);
    service.record(0);
    service.record(Number.NaN);
    expect(query).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-09-22T17:00:00Z'));
    service.record(50);
    await service.flush();
    expect(query.mock.calls[0][1]).toEqual([
      expect.any(String), [new Date('2026-09-22T16:00:00Z'), new Date('2026-09-22T17:00:00Z')], [200, 50],
    ]);
    await service.flush();
    expect(query).toHaveBeenCalledTimes(1);
    service.record(25);
    await service.flush();
    expect(query.mock.calls[1][1][2]).toEqual([75]);
    expect(query.mock.calls[1][0]).toContain('GREATEST(chat_relay_traffic.bytes, EXCLUDED.bytes)');
  });

  it('serializes flushes and retains frames arriving while a write is pending', async () => {
    const { query, service } = setup();
    let finish!: () => void;
    query.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    service.record(100);
    const pending = service.flush();
    service.record(50);
    expect(service.flush()).toBe(pending);
    expect(query).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    await service.flush();
    expect(query.mock.calls[1][1][2]).toEqual([150]);
    await service.flush();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('retries failures with the same absolute counter and uses a new reporter after restart', async () => {
    const { query, service } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    query.mockRejectedValueOnce(new Error('Connection lost after commit'));
    service.record(42);
    await expect(service.flush()).resolves.toBeUndefined();
    await service.flush();
    expect(query.mock.calls[1][1]).toEqual(query.mock.calls[0][1]);
    expect(warn).toHaveBeenCalledTimes(1);
    const restarted = new ChatTrafficService({ query } as unknown as DataSource);
    restarted.record(20);
    await restarted.flush();
    expect(query.mock.calls[2][1][0]).not.toBe(query.mock.calls[0][1][0]);
  });

  it('flushes on schedule and drains pending records during shutdown', async () => {
    const { query, service } = setup();
    service.onModuleInit();
    service.record(10);
    await vi.advanceTimersByTimeAsync(5000);
    expect(query).toHaveBeenCalledTimes(1);
    service.record(15);
    await service.onModuleDestroy();
    expect(query.mock.calls[1][1][2]).toEqual([25]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reads stored lifetime and hourly counters even after a restart', async () => {
    const { query, service } = setup();
    query.mockResolvedValueOnce([
      { hourStart: null, bytes: '4321' },
      { hourStart: '2026-09-22T16:00:00Z', bytes: '123' },
    ]);
    const result = await service.getOverview(7);
    expect(query.mock.calls[0][1]).toEqual([
      new Date('2026-09-16T16:00:00Z'), new Date('2026-09-23T16:00:00Z'),
    ]);
    expect(result.totalBytes).toBe(4321);
    expect(result.daily.at(-1)).toMatchObject({ date: '2026-09-23', bytes: 123 });
  });
});
