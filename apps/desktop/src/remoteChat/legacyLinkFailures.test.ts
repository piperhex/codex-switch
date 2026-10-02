import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatLink } from '../../../../shared/remote-chat/link';
import { keyPair } from '../../../../shared/remote-chat/cipher';
import { CONNECTION_ERRORS } from '../../../../shared/remote-chat/connectionErrors';
import { DIRECT_TIMEOUT_MS, RELAY_START_GRACE_MS, type PeerOptions } from '../../../../shared/remote-chat/protocol';

const links: ChatLink[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { links.splice(0).forEach(link => link.close()); vi.useRealTimers(); });

function harness(open = true) {
  const keys = keyPair(size => new Uint8Array(size).fill(1));
  const remote = keyPair(size => new Uint8Array(size).fill(2));
  let peer!: PeerOptions;
  let channelClosed = () => {};
  const channel = { readyState: open ? 'open' : 'connecting', bufferedAmount: 0,
    send: vi.fn(), close: vi.fn(), onOpen() {}, onMessage() {},
    onClose: (callback: () => void) => { channelClosed = callback; } };
  const signal = vi.fn();
  const error = vi.fn();
  const mode = vi.fn();
  const closePeer = vi.fn();
  const link = new ChatLink({ sessionId: 'legacy', transportVersion: 1, desktop: false,
    secret: keys.secret, publicKey: remote.publicKey, iceServers: [], signal,
    relayBuffered: () => 0, message: vi.fn(), mode, error,
    createPeer: options => {
      peer = options;
      return { offer: async () => {}, accept: async () => {}, close: closePeer };
    } });
  links.push(link);
  peer.channel(channel);
  return { link, peer, channel, signal, error, mode, closePeer, channelClosed: () => channelClosed() };
}

it.each(['channel', 'candidate'] as const)('handles a socket failure during a late %s callback', trigger => {
  const test = harness();
  test.signal.mockImplementation(() => { throw new Error('Disconnected'); });
  const callback = trigger === 'channel' ? test.channelClosed
    : () => test.peer.signal({ kind: 'ice', candidate: 'fixture', sdpMid: null, sdpMLineIndex: null });
  expect(callback).not.toThrow();
  expect(test.error).toHaveBeenCalledExactlyOnceWith(CONNECTION_ERRORS.network);
  expect(test.mode).toHaveBeenLastCalledWith('offline');
  expect(test.closePeer).toHaveBeenCalledOnce();
  expect(test.channel.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(callback).not.toThrow();
  expect(test.signal).toHaveBeenCalledOnce();
});

it('handles a failed relay request from the direct discovery timer', async () => {
  const test = harness(false);
  test.signal.mockImplementation(() => { throw new Error('Disconnected'); });
  await vi.advanceTimersByTimeAsync(DIRECT_TIMEOUT_MS + RELAY_START_GRACE_MS);
  expect(test.mode).toHaveBeenLastCalledWith('offline');
  expect(test.error).toHaveBeenCalledExactlyOnceWith(CONNECTION_ERRORS.network);
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects a failed relay send without acknowledging delivery', async () => {
  const test = harness();
  test.link.enableRelay();
  test.signal.mockImplementation(() => { throw new Error('Disconnected'); });
  const progress = vi.fn();
  await expect(test.link.send({ kind: 'request', id: 'once', method: 'request' }, progress)).rejects.toThrow();
  expect(progress.mock.calls.some(([fraction]) => fraction === 1)).toBe(false);
  expect(test.mode).toHaveBeenLastCalledWith('offline');
  expect(test.error).toHaveBeenCalledExactlyOnceWith(CONNECTION_ERRORS.network);
});
