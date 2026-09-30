import { afterEach, expect, it, vi } from 'vitest';
import { NativePath, type NativePathBridge, type NativePathEvent } from '../../../../shared/remote-chat/nativePath';
import { HotPeer } from '../../../../shared/remote-chat/hotPeer';
import type { Channel, PeerOptions } from '../../../../shared/remote-chat/protocol';

const config = { secret: 'ab'.repeat(32), servers: ['udp://peer.example:11010'],
  stunServers: ['stun.example:3478'], expiresAt: 100_000 };
afterEach(() => vi.useRealTimers());

function harness(open?: NativePathBridge['open']) {
  let receive!: (event: NativePathEvent) => void;
  const bridge = { open: open ?? vi.fn(async (_options, callback) => { receive = callback; return 'handle'; }),
    send: vi.fn(async () => {}), close: vi.fn(async () => {}), renew: vi.fn(async () => {}) } satisfies NativePathBridge;
  const path = new NativePath({ sessionId: 'session', desktop: false, config }, bridge);
  return { path, bridge, receive: (event: NativePathEvent) => receive(event) };
}

it('returns to connecting on route loss, reopens after recovery, and forwards native lease renewals', async () => {
  const test = harness(), opened = vi.fn(), messages = vi.fn();
  test.path.onOpen(opened); test.path.onMessage(messages);
  test.receive({ type: 'open' }); test.path.send('packet');
  await vi.waitFor(() => expect(test.bridge.send).toHaveBeenCalledWith('handle', 'packet'));
  test.receive({ type: 'status', route: { direct: false, ipv6: false } });
  expect(test.path.readyState).toBe('connecting'); expect(() => test.path.send('lost')).toThrow();
  test.receive({ type: 'open' }); test.receive({ type: 'data', text: 'reply' });
  test.path.renew(200_000);
  await vi.waitFor(() => expect(test.bridge.renew).toHaveBeenCalledWith('handle', 200_000));
  expect(opened).toHaveBeenCalledTimes(2); expect(messages).toHaveBeenCalledWith('reply');
  test.path.close(); test.receive({ type: 'open' });
  expect(test.path.readyState).toBe('closed');
});

it('releases a native handle that arrives after the owner has closed', async () => {
  let resolve!: (id: string) => void;
  const test = harness(() => new Promise(done => { resolve = done; }));
  test.path.close(); resolve('late');
  await vi.waitFor(() => expect(test.bridge.close).toHaveBeenCalledWith('late'));
});

it('keeps the native engine across multiple ICE generations and closes it with the session', () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const native = { readyState: 'connecting', bufferedAmount: 0, send: vi.fn(), close: vi.fn(), renew: vi.fn(),
    onOpen: vi.fn(), onClose: vi.fn(), onMessage: vi.fn() };
  const createNativePath = vi.fn(() => native), channel = vi.fn();
  const createPeer = vi.fn((_options: PeerOptions) => ({ offer: async () => {}, accept: async () => {}, close: vi.fn() }));
  const peer = new HotPeer({ sessionId: 'session', desktop: false, iceServers: [], nativeTraversal: config,
    createNativePath, createPeer, channel, signal: vi.fn(), disconnected: vi.fn() });
  for (const now of [60_000, 110_000, 160_000]) { vi.setSystemTime(now); peer.recover(false, true); }
  expect(createPeer).toHaveBeenCalledTimes(4); expect(createNativePath).toHaveBeenCalledOnce();
  expect(channel).toHaveBeenCalledOnce(); expect(native.close).not.toHaveBeenCalled();
  peer.renew(200_000); expect(native.renew).toHaveBeenCalledWith(200_000);
  peer.close(); expect(native.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('does not interrupt a healthy native path when RTC negotiation fails', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  let receive!: (text: string) => void;
  const native = { readyState: 'open', bufferedAmount: 0, close: vi.fn(), renew: vi.fn(),
    onOpen: vi.fn(), onClose: vi.fn(), onMessage: (fn: (text: string) => void) => { receive = fn; },
    send: (text: string) => { const [kind, id] = JSON.parse(text); if (kind === 'ping') receive(JSON.stringify(['pong', id])); },
  } satisfies Channel & { renew: (expires: number) => void };
  const disconnected = vi.fn();
  const peer = new HotPeer({ sessionId: 'session', desktop: false, iceServers: [], nativeTraversal: config,
    createNativePath: () => native, channel: vi.fn(), signal: vi.fn(), disconnected,
    createPeer: () => ({ offer: async () => { throw new Error('RTC failed'); }, accept: async () => {}, close: vi.fn() }),
  });
  await peer.offer(); expect(disconnected).not.toHaveBeenCalled(); peer.close();
});
