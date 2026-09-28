import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hotLinkHarness } from './hotLinkHarness';
import { chatMessageCharLimit } from '../../../../shared/remote-chat/framing';

let harness: ReturnType<typeof hotLinkHarness>;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  harness = hotLinkHarness();
  await vi.advanceTimersByTimeAsync(4500);
});
afterEach(() => { harness.close(); vi.clearAllTimers(); vi.useRealTimers(); });

it('recovers chat data over relay when direct heartbeats succeed but data is lost', async () => {
  harness.filter(packet => !(packet.path === 'direct' && packet.frame.kind === 'data'));
  const event = { kind: 'event' as const, event: 'still running on the PC' };
  await harness.links.pc.send(event);
  await vi.advanceTimersByTimeAsync(2000);
  expect(harness.messages.phone).toEqual([event]);
  expect(harness.packets.some(packet => packet.path === 'relay' && packet.frame.kind === 'data')).toBe(true);
  await vi.advanceTimersByTimeAsync(65_000);
  expect(harness.error).not.toHaveBeenCalled();
  expect(harness.modes.pc).not.toContain('offline');
});

it('recovers a lost direct acknowledgement without delivering the event twice', async () => {
  harness.filter(packet => !(packet.path === 'direct' && packet.frame.kind === 'ack'));
  const event = { kind: 'event' as const, event: 'only once' };
  await harness.links.pc.send(event);
  await vi.advanceTimersByTimeAsync(65_000);
  expect(harness.messages.phone).toEqual([event]);
  expect(harness.error).not.toHaveBeenCalled();
  expect(harness.modes.pc).not.toContain('offline');
});

it('keeps healthy direct traffic off the relay', async () => {
  const start = harness.packets.length;
  const event = { kind: 'event' as const, event: 'direct only' };
  await harness.links.pc.send(event);
  await vi.advanceTimersByTimeAsync(2000);
  expect(harness.messages.phone).toEqual([event]);
  const data = harness.packets.slice(start).filter(packet => packet.frame.kind === 'data');
  expect(data).toHaveLength(1);
  expect(data[0].path).toBe('direct');
});

it('recovers stalled relay data over a newly healthy direct path before switching back', async () => {
  harness.paths.direct = false;
  await vi.advanceTimersByTimeAsync(3500);
  harness.paths.direct = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(harness.links.pc.connectionMode).toBe('relay');
  harness.filter(packet => !(packet.path === 'relay' && packet.frame.kind === 'data'));
  const event = { kind: 'event' as const, event: 'relay retry' };
  await harness.links.pc.send(event);
  await vi.advanceTimersByTimeAsync(1500);
  expect(harness.links.pc.connectionMode).toBe('relay');
  expect(harness.messages.phone).toEqual([event]);
  expect(harness.error).not.toHaveBeenCalled();
});

it('never sends backup data through a quota-blocked relay', async () => {
  harness.links.pc.setRelayQuotaBlocked(true);
  harness.links.phone.setRelayQuotaBlocked(true);
  const start = harness.packets.length;
  harness.filter(packet => packet.frame.kind !== 'data');
  const event = { kind: 'event' as const, event: 'wait for direct' };
  await harness.links.pc.send(event);
  await vi.advanceTimersByTimeAsync(2000);
  expect(harness.packets.slice(start).some(packet => packet.path === 'relay')).toBe(false);
  expect(harness.messages.phone).toEqual([]);
  harness.filter(() => true);
  await vi.advanceTimersByTimeAsync(1500);
  expect(harness.messages.phone).toEqual([event]);
  expect(harness.error).not.toHaveBeenCalled();
});

it('keeps direct-only large messages off the relay while their first fragments are unconfirmed', async () => {
  harness.filter(packet => packet.frame.kind !== 'data' || packet.path !== 'direct');
  const event = { kind: 'event' as const, event: 'x'.repeat(chatMessageCharLimit('relay') + 1) };
  const sent = harness.links.pc.send(event);
  // Observe failure without leaving an unhandled rejection if this regression returns.
  const result = sent.catch(error => error as Error);
  await vi.advanceTimersByTimeAsync(2000);
  expect(harness.error).not.toHaveBeenCalled();
  expect(harness.packets.some(packet => packet.path === 'relay' && packet.frame.kind === 'data')).toBe(false);
  harness.filter(() => true);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(result).resolves.toBeUndefined();
  expect(harness.messages.phone).toEqual([event]);
});

it('still bounds undeliverable data when heartbeats on both paths keep succeeding', async () => {
  harness.filter(packet => packet.frame.kind !== 'data');
  await harness.links.pc.send({ kind: 'event', event: 'unreachable' });
  await vi.advanceTimersByTimeAsync(65_000);
  expect(harness.messages.phone).toEqual([]);
  expect(harness.error).toHaveBeenCalled();
  expect(harness.modes.pc.at(-1)).toBe('offline');
});
