import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HotPeer } from '../../../../shared/remote-chat/hotPeer';
import type { Channel, PeerOptions } from '../../../../shared/remote-chat/protocol';
import { DEFAULT_CHAT_POLICY, setChatPolicy } from '../../../../shared/remote-chat/policy';

const answer = { kind: 'sdp' as const, type: 'answer' as const, sdp: 'answer' };
const offer = { kind: 'sdp' as const, type: 'offer' as const, sdp: 'offer' };
const start = 100_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
afterEach(() => { setChatPolicy(DEFAULT_CHAT_POLICY); vi.useRealTimers(); });
const at = (elapsed: number) => vi.setSystemTime(start + elapsed);

function harness(desktop = false) {
  const createPeer = vi.fn((options: PeerOptions) => ({ options,
    offer: vi.fn(async (): Promise<void> => undefined),
    accept: vi.fn(async (): Promise<void> => undefined), close: vi.fn() }));
  const options = { desktop, iceServers: [], createPeer,
    signal: vi.fn(), channel: vi.fn(), disconnected: vi.fn() };
  const peer = new HotPeer(options);
  const current = () => createPeer.mock.results.at(-1)!.value;
  return { peer, current, ...options };
}

it('keeps a slow negotiation alive past the old ten-second restart deadline', async () => {
  const { peer, current, createPeer } = harness();
  await peer.offer();
  current().options.stateChanged?.('connecting');
  for (const elapsed of [10_000, 12_000, 30_000, 44_999]) {
    at(elapsed);
    peer.recover(false, true);
  }
  expect(createPeer).toHaveBeenCalledOnce();
  expect(current().close).not.toHaveBeenCalled();
  await peer.accept(answer);
  peer.recover(true, true);
  at(90_000);
  peer.recover(true, true);
  expect(createPeer).toHaveBeenCalledOnce();
  peer.close();
});

it('bounds a stalled negotiation and discards late signals from the replaced attempt', async () => {
  const { peer, current, createPeer, signal } = harness();
  const original = current();
  at(45_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  expect(original.close).toHaveBeenCalledOnce();
  expect(current().offer).toHaveBeenCalledOnce();
  await peer.accept({ ...answer, generation: 0 });
  original.options.signal(offer);
  expect(current().accept).not.toHaveBeenCalled();
  expect(signal).not.toHaveBeenCalled();
  current().options.signal(offer);
  expect(signal).toHaveBeenCalledWith({ ...offer, generation: 1 });
  peer.close();
});

it.each(['failed', 'closed'] as const)('retries a %s state before the full negotiation deadline', state => {
  const { peer, current, createPeer } = harness();
  current().options.stateChanged?.(state);
  at(9999);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledOnce();
  at(10_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  at(20_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  peer.close();
});

it('gives an established connection a fresh grace period after each transient outage', () => {
  const { peer, current, createPeer } = harness();
  peer.recover(true, true);
  at(120_000);
  current().options.stateChanged?.('disconnected');
  peer.recover(false, true);
  at(129_999);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledOnce();
  current().options.stateChanged?.('connected');
  peer.recover(true, true);
  at(200_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledOnce();
  at(210_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  peer.close();
});

it('does not restart without signaling and lets only the initiating client start recovery', async () => {
  const client = harness();
  const host = harness(true);
  at(60_000);
  client.peer.recover(false, false);
  host.peer.recover(false, true);
  expect(client.createPeer).toHaveBeenCalledOnce();
  expect(host.createPeer).toHaveBeenCalledOnce();
  client.peer.recover(false, true);
  expect(client.createPeer).toHaveBeenCalledTimes(2);
  await host.peer.accept({ ...offer, generation: 1 });
  expect(host.createPeer).toHaveBeenCalledTimes(2);
  expect(host.current().accept).toHaveBeenCalledWith({ ...offer, generation: 1 });
  client.peer.close();
  host.peer.close();
  at(120_000);
  client.peer.recover(false, true);
  expect(client.createPeer).toHaveBeenCalledTimes(2);
});

it('ignores late state changes and offer rejections from a replaced peer', async () => {
  const { peer, current, createPeer, disconnected } = harness();
  const original = current();
  let reject!: (error: Error) => void;
  original.offer.mockReturnValueOnce(new Promise<void>((_resolve, failed) => { reject = failed; }));
  const offered = peer.offer();
  at(45_000);
  peer.recover(false, true);
  original.options.stateChanged?.('failed');
  reject(new Error('Old offer closed'));
  await offered;
  at(55_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  expect(disconnected).not.toHaveBeenCalled();
  peer.close();
});

it('retries a rejected offer or a closed data channel as a terminal failure', async () => {
  const { peer, current, createPeer } = harness();
  current().offer.mockRejectedValueOnce(new Error('Offer failed'));
  await peer.offer();
  at(10_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  let closed = () => {};
  const channel: Channel = { readyState: 'open', bufferedAmount: 0,
    send() {}, close() {}, onOpen() {}, onMessage() {}, onClose(callback) { closed = callback; } };
  current().options.channel(channel);
  closed();
  at(20_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(3);
  peer.close();
});

it('applies live timeout and retry updates to an already running attempt', () => {
  const { peer, current, createPeer } = harness();
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, p2pNegotiationTimeoutSeconds: 90 });
  at(45_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledOnce();
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, p2pNegotiationTimeoutSeconds: 30, p2pRetryIntervalSeconds: 1 });
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  current().options.stateChanged?.('failed');
  at(46_000);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(3);
  peer.close();
});

it('accepts very large durations without timer overflow and applies a shorter recovery grace immediately', () => {
  const { peer, createPeer } = harness();
  const large = { ...DEFAULT_CHAT_POLICY, p2pNegotiationTimeoutSeconds: Number.MAX_SAFE_INTEGER,
    p2pRetryIntervalSeconds: Number.MAX_SAFE_INTEGER, p2pDisconnectGraceSeconds: Number.MAX_SAFE_INTEGER };
  setChatPolicy(large);
  at(2 ** 32);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledOnce();
  peer.recover(true, true);
  peer.recover(false, true);
  setChatPolicy({ ...large, p2pRetryIntervalSeconds: 1 });
  at(2 ** 33);
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledOnce();
  setChatPolicy({ ...large, p2pRetryIntervalSeconds: 1, p2pDisconnectGraceSeconds: 1 });
  peer.recover(false, true);
  expect(createPeer).toHaveBeenCalledTimes(2);
  peer.close();
});
