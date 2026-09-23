import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hotLinkHarness } from './hotLinkHarness';

let harness: ReturnType<typeof hotLinkHarness>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); harness = hotLinkHarness(); });
afterEach(() => { harness.close(); vi.useRealTimers(); });
const advance = (milliseconds = 4500) => vi.advanceTimersByTimeAsync(milliseconds);

it('delivers independent replies and ordered events while an earlier response fragment is missing', async () => {
  harness.paths.direct = false;
  await advance();
  harness.filter((packet) => !(packet.side === 'pc' && packet.frame.kind === 'data'
    && packet.frame.lane === 'responses' && packet.frame.sequence === 1));
  const history = { kind: 'response' as const, id: 'large', data: 'x'.repeat(500_000) };
  const reply = { kind: 'response' as const, id: 'small', data: 'ready' };
  const sent = harness.links.pc.send(history);
  void harness.links.pc.send(reply);
  await advance(100);
  const event = { kind: 'event' as const, event: 'live output' };
  await harness.links.pc.send(event);
  await advance(100);
  expect(harness.messages.phone).toEqual([reply, event]);
  harness.filter(() => true);
  await advance(3000);
  await sent;
  expect(harness.messages.phone).toEqual([reply, event, history]);
  expect(harness.error).not.toHaveBeenCalled();
});

it('streams an interleaved small reply over relay without a delay per fragment', async () => {
  harness.paths.direct = false;
  await advance();
  expect(harness.modes.pc.at(-1)).toBe('relay');
  const history = { kind: 'response' as const, id: 'old-history', data: 'x'.repeat(1024 * 1024) };
  const reply = { kind: 'response' as const, id: 'new-chat', data: 'ready' };
  const sent = harness.links.pc.send(history);
  const replied = harness.links.pc.send(reply);
  await advance(1);
  await Promise.all([sent, replied]);
  expect(harness.messages.phone).toEqual([reply, history]);
  expect(harness.error).not.toHaveBeenCalled();
});

it('keeps both paths warm, sends data only on P2P and recovers from a silent one-way black hole', async () => {
  await advance();
  expect(harness.modes.phone.at(-1)).toBe('direct');
  const start = harness.packets.length;
  void harness.links.pc.send({ kind: 'event', event: 'before' });
  await advance(50);
  expect(harness.packets.slice(start).filter((packet) => packet.frame.kind === 'data')
    .every((packet) => packet.path === 'direct')).toBe(true);
  harness.filter((packet) => !(packet.path === 'direct' && packet.side === 'pc'));
  void harness.links.pc.send({ kind: 'event', event: 'during' });
  await advance(4000);
  expect(harness.modes.pc.at(-1)).toBe('relay');
  expect(harness.messages.phone).toEqual([{ kind: 'event', event: 'before' }, { kind: 'event', event: 'during' }]);
  expect(harness.error).not.toHaveBeenCalled();
});

it('does not tear down P2P when relay fails and switches back only after P2P stays stable', async () => {
  await advance();
  harness.paths.relay = false;
  harness.links.phone.setRelayAvailable(false);
  harness.links.pc.setRelayAvailable(false);
  void harness.links.phone.send({ kind: 'request', id: 'once', method: 'request' });
  await advance(1000);
  expect(harness.modes.phone.at(-1)).toBe('direct');
  expect(harness.messages.pc).toHaveLength(1);
  harness.restoreRelay();
  await advance(1000);
  harness.paths.direct = false;
  await advance(4000);
  expect(harness.modes.phone.at(-1)).toBe('relay');
  harness.paths.direct = true;
  await advance(1500);
  expect(harness.modes.phone.at(-1)).toBe('relay');
  await advance(3500);
  expect(harness.modes.phone.at(-1)).toBe('direct');
  expect(harness.modes.phone).not.toContain('offline');
});

it('replays an unacknowledged fragment without duplicating a delivered event', async () => {
  await advance();
  harness.filter((packet) => !(packet.path === 'direct' && packet.frame.kind === 'ack'));
  void harness.links.pc.send({ kind: 'event', event: 'exactly once' });
  await advance(100);
  expect(harness.messages.phone).toHaveLength(1);
  harness.paths.direct = false;
  await advance(4500);
  expect(harness.messages.phone).toEqual([{ kind: 'event', event: 'exactly once' }]);
  expect(harness.packets.some((packet) => packet.path === 'relay' && packet.frame.kind === 'data')).toBe(true);
});

it('preserves a fragmented reply and later events through loss, reordering and both-path outage', async () => {
  await advance();
  const delayed: Parameters<typeof harness.deliver>[0][] = [];
  harness.filter((packet) => {
    if (packet.path === 'direct' && packet.frame.kind === 'data' && packet.frame.sequence === 2) {
      delayed.push(packet); return false;
    }
    return true;
  });
  const event = { kind: 'event' as const, event: '中文😀'.repeat(15_000) };
  const sent = harness.links.pc.send(event);
  void harness.links.pc.send({ kind: 'event', event: 'finished' });
  await advance(250);
  harness.paths.direct = false;
  harness.paths.relay = false;
  await advance(5000);
  expect(harness.messages.phone).toEqual([]);
  harness.restoreRelay();
  await advance(9000);
  await sent;
  delayed.reverse().forEach(harness.deliver);
  await advance(1000);
  expect(harness.messages.phone).toEqual([event, { kind: 'event', event: 'finished' }]);
  expect(harness.error).not.toHaveBeenCalled();
});

it('bounds an outage, rejects blocked work and cleans up all transport timers', async () => {
  await advance();
  harness.paths.direct = false;
  harness.paths.relay = false;
  const pending = harness.links.pc.send({ kind: 'event', event: 'x'.repeat(500_000) });
  const rejected = expect(pending).rejects.toThrow();
  await advance(65_000);
  await rejected;
  expect(harness.modes.pc.at(-1)).toBe('offline');
  harness.close();
  await advance(1000);
  expect(vi.getTimerCount()).toBe(0);
});

it('retains already acknowledged fragments when a large message spans a long but recoverable outage', async () => {
  await advance();
  const event = { kind: 'event' as const, event: 'x'.repeat(2_000_000) };
  const sent = harness.links.pc.send(event);
  await advance(100);
  harness.paths.direct = false;
  harness.paths.relay = false;
  await advance(54_000);
  harness.restoreRelay();
  await advance(12_000);
  await sent;
  expect(harness.messages.phone).toEqual([event]);
  expect(harness.error).not.toHaveBeenCalled();
});
