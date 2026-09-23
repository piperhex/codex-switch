import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RelayQuota } from '../../../../shared/remote-chat/relayUsage';
import { hotLinkHarness } from './hotLinkHarness';

let harness: ReturnType<typeof hotLinkHarness>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { harness?.close(); vi.clearAllTimers(); vi.useRealTimers(); });

it('preserves a partial-frame rejection until the allowance changes or a new month starts', () => {
  const quota = new RelayQuota();
  const usage = { monthUsedBytes: 99, monthlyLimitBytes: 100, resetAt: '2026-10-01T00:00:00+08:00' };
  quota.receive({ type: 'relay-usage', usage });
  quota.receive({ type: 'relay-quota', blocked: true });
  quota.receive({ type: 'relay-usage', usage });
  expect(quota.blocked).toBe(true);
  quota.receive({ type: 'relay-usage', usage: { ...usage, monthlyLimitBytes: 200 } });
  expect(quota.blocked).toBe(false);
  quota.receive({ type: 'relay-quota', blocked: true });
  quota.receive({ type: 'relay-usage', usage: { ...usage, monthUsedBytes: 0, resetAt: '2026-11-01T00:00:00+08:00' } });
  expect(quota.blocked).toBe(false);
});

it('continues encrypted P2P traffic after quota exhaustion without relay probes or reconnect loops', async () => {
  harness = hotLinkHarness();
  await vi.advanceTimersByTimeAsync(4500);
  for (const link of Object.values(harness.links)) link.setRelayQuotaBlocked(true);
  const before = harness.packets.filter((packet) => packet.path === 'relay').length;
  const request = { kind: 'request' as const, id: 'direct-after-quota', method: 'connect' as const };
  const pending = harness.links.phone.send(request);
  await vi.advanceTimersByTimeAsync(35_000);
  await pending;
  expect(harness.messages.pc).toEqual([request]);
  expect(harness.links.phone.connectionMode).toBe('direct');
  expect(harness.packets.filter((packet) => packet.path === 'relay')).toHaveLength(before);
  expect(harness.reconnect).not.toHaveBeenCalled();
  expect(harness.error).not.toHaveBeenCalled();
});

it('resumes pending relay messages when an administrator increases the quota', async () => {
  harness = hotLinkHarness();
  harness.paths.direct = false;
  await vi.advanceTimersByTimeAsync(1500);
  for (const link of Object.values(harness.links)) link.setRelayQuotaBlocked(true);
  const request = { kind: 'request' as const, id: 'wait-for-allowance', method: 'connect' as const };
  const pending = harness.links.phone.send(request);
  await vi.advanceTimersByTimeAsync(1000);
  expect(harness.messages.pc).toEqual([]);
  for (const link of Object.values(harness.links)) link.setRelayQuotaBlocked(false);
  await vi.advanceTimersByTimeAsync(1500);
  await pending;
  expect(harness.messages.pc).toEqual([request]);
  expect(harness.links.phone.connectionMode).toBe('relay');
});
