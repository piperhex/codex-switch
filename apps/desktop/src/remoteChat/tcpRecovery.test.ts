import { afterEach, expect, it, vi } from 'vitest';
import { TcpPeer } from '../../../../shared/remote-chat/tcp/peer';
import { TcpCandidates } from '../../../../shared/remote-chat/tcp/candidates';
import { MultipathPeer } from '../../../../shared/remote-chat/multipathPeer';
import type { TcpNetwork, TcpSignal, TcpSocket } from '../../../../shared/remote-chat/tcp/types';

afterEach(() => vi.useRealTimers());
const random = (length: number) => new Uint8Array(length).fill(8);

function harness(connect: TcpNetwork['connect'] = async () => { throw new Error('unreachable'); }) {
  const signal = vi.fn(), channel = vi.fn(), exhausted = vi.fn();
  const network: TcpNetwork = {
    listen: vi.fn(async ipv6 => ({ port: ipv6 ? 45001 : 45000, close: vi.fn() })),
    connect: vi.fn(connect), close: vi.fn(),
    localAddresses: async () => ['192.168.1.7', '2001:db8::7'],
  };
  const peer = new TcpPeer({ config: { servers: [{ host: 'stun.example', port: 3478 }] },
    sessionId: 'test', desktop: false, random, signal, channel, exhausted }, network);
  return { peer, network, signal, channel, exhausted };
}

it('tries DNS discovery with both families and advertises LAN addresses even when all STUN calls fail', async () => {
  vi.useFakeTimers();
  const test = harness();
  await vi.advanceTimersByTimeAsync(0);
  expect(test.network.listen).toHaveBeenCalledWith(false, expect.any(Function));
  expect(test.network.listen).toHaveBeenCalledWith(true, expect.any(Function));
  expect(test.network.connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'stun.example', ipv6: true }));
  const candidates = test.signal.mock.calls.at(-1)![0] as TcpSignal;
  expect(candidates.addresses).toEqual(expect.arrayContaining([
    { host: '192.168.1.7', port: 45000 }, { host: '2001:db8::7', port: 45001 },
  ]));
  test.peer.close(); expect(vi.getTimerCount()).toBe(0);
});

it('retries transient peer failures with a bounded budget and cancels timers on close', async () => {
  vi.useFakeTimers();
  const test = harness();
  test.peer.accept({ kind: 'tcp', publicKey: '11'.repeat(32), addresses: [{ host: '192.168.1.8', port: 45000 }] });
  await vi.advanceTimersByTimeAsync(5000);
  expect(vi.mocked(test.network.connect).mock.calls.filter(([address]) => address.host === '192.168.1.8')).toHaveLength(5);
  test.peer.close(); await vi.advanceTimersByTimeAsync(20_000);
  expect(test.exhausted).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('closes a late socket after discovery exhaustion instead of resurrecting an expired attempt', async () => {
  vi.useFakeTimers();
  let resolve!: (socket: TcpSocket) => void;
  const test = harness(address => address.host === '192.168.1.8'
    ? new Promise(done => { resolve = done; }) : Promise.reject(new Error('STUN down')));
  test.peer.accept({ kind: 'tcp', publicKey: '11'.repeat(32), addresses: [{ host: '192.168.1.8', port: 45000 }] });
  await vi.advanceTimersByTimeAsync(15_000);
  const close = vi.fn(); resolve({ close } as unknown as TcpSocket);
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalledOnce(); expect(test.channel).not.toHaveBeenCalled();
  expect(test.exhausted).toHaveBeenCalledOnce(); test.peer.close();
});

it('retries a socket that connected but timed out during authentication', async () => {
  vi.useFakeTimers();
  const test = harness(async address => {
    if (address.host !== '192.168.1.8') throw new Error('STUN down');
    const callbacks = new Set<() => void>();
    return { localAddress: '192.168.1.7', localPort: 45000, bufferedAmount: 0,
      write: vi.fn(), onData: vi.fn(), onClose: callback => { callbacks.add(callback); },
      close: () => { callbacks.forEach(callback => callback()); callbacks.clear(); } };
  });
  test.peer.accept({ kind: 'tcp', publicKey: '11'.repeat(32), addresses: [{ host: '192.168.1.8', port: 45000 }] });
  await vi.advanceTimersByTimeAsync(5300);
  expect(vi.mocked(test.network.connect).mock.calls.filter(([address]) => address.host === '192.168.1.8')).toHaveLength(2);
  test.peer.close(); expect(vi.getTimerCount()).toBe(0);
});

it('reserves public IPv4 and IPv6 candidates when many local adapters are enumerated first', () => {
  const candidates = new TcpCandidates();
  for (let index = 1; index <= 20; index++) candidates.add({ host: `10.0.0.${index}`, port: 45000 }, 'local');
  candidates.add({ host: '2001:db8::7', port: 45001 }, 'local');
  candidates.add({ host: '203.0.113.1', port: 45002 }, 'mapped');
  candidates.add({ host: '2001:db8::8', port: 45003 }, 'mapped');
  expect(candidates.values()).toHaveLength(6);
  expect(candidates.values().slice(0, 2)).toEqual([
    { host: '203.0.113.1', port: 45002 }, { host: '2001:db8::8', port: 45003 },
  ]);
});

it('reports failure as soon as RTC and TCP are exhausted so the outer retry can start', async () => {
  vi.useFakeTimers();
  const stateChanged = vi.fn();
  const peer = new MultipathPeer({ sessionId: 'test', iceServers: [],
    tcp: { servers: [{ host: 'stun.example', port: 3478 }] }, stateChanged, signal: vi.fn(),
    channel: vi.fn(), disconnected: vi.fn() }, { random,
    rtc: () => ({ offer: async () => {}, accept: async () => { throw new Error('bad SDP'); }, close: vi.fn() }),
    network: { listen: async () => { throw new Error('no sockets'); },
      connect: async () => { throw new Error('no sockets'); }, close: vi.fn() },
  });
  await peer.accept({ kind: 'sdp', type: 'answer', sdp: 'invalid' });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(stateChanged).toHaveBeenCalledWith('failed'); peer.close();
});
