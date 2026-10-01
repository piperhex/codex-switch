import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hotLinkHarness } from './hotLinkHarness';

let harness: ReturnType<typeof hotLinkHarness>;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  harness = hotLinkHarness();
  for (const link of Object.values(harness.links)) link.renew(Date.now() + 600_000);
  await vi.advanceTimersByTimeAsync(4500);
});
afterEach(() => { harness.close(); vi.useRealTimers(); });

it('retains a fragmented reply and completion through a three-minute background outage', async () => {
  const reply = { kind: 'response' as const, id: 'history', data: 'x'.repeat(2_000_000) };
  const sent = harness.links.pc.send(reply);
  await vi.advanceTimersByTimeAsync(100);
  harness.paths.direct = false;
  harness.paths.relay = false;
  const completion = { kind: 'event' as const, event: 'completed while in background' };
  const completed = harness.links.pc.send(completion);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(harness.links.phone.resumable).toBe(true);
  expect(harness.links.pc.resumable).toBe(true);
  expect(harness.modes.phone).not.toContain('offline');
  expect(harness.modes.pc).not.toContain('offline');
  harness.restoreRelay();
  await vi.advanceTimersByTimeAsync(12_000);
  await Promise.all([sent, completed]);
  expect(harness.messages.phone).toHaveLength(2);
  expect(harness.messages.phone).toContainEqual(reply);
  expect(harness.messages.phone).toContainEqual(completion);
  expect(harness.error).not.toHaveBeenCalled();
});

it('does not count a suspended runtime against pending delivery deadlines', async () => {
  harness.filter(packet => packet.frame.kind !== 'ack');
  const event = { kind: 'event' as const, event: 'delivered once' };
  await harness.links.pc.send(event);
  await vi.advanceTimersByTimeAsync(100);
  vi.setSystemTime(Date.now() + 180_000);
  harness.filter(() => true);
  await vi.advanceTimersByTimeAsync(5000);
  harness.restoreRelay();
  await vi.advanceTimersByTimeAsync(5000);
  expect(harness.messages.phone).toEqual([event]);
  expect(harness.error).not.toHaveBeenCalled();
  expect(harness.modes.phone).not.toContain('offline');
  expect(harness.modes.pc).not.toContain('offline');
});

it('closes an unreachable session at its authorization deadline and releases blocked sends', async () => {
  for (const link of Object.values(harness.links)) link.renew(Date.now() + 90_000);
  harness.paths.direct = false;
  harness.paths.relay = false;
  const rejected = expect(harness.links.pc.send({ kind: 'event', event: 'x'.repeat(2_000_000) })).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(90_250);
  await rejected;
  expect(harness.links.phone.resumable).toBe(false);
  expect(harness.links.pc.resumable).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
