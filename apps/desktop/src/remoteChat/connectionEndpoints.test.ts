import { afterEach, expect, it, vi } from 'vitest';
import { selectedIcePair } from '../../../../shared/remote-chat/rtcDiagnostics';
import { RtcObserver } from '../../../../shared/remote-chat/rtcObserver';
import { connectionEndpoint, type ConnectionEndpoints } from '../../../../shared/remote-chat/connectionEndpoints';
import { ChatLink } from '../../../../shared/remote-chat/link';
import { MultipathChannel } from '../../../../shared/remote-chat/multipathChannel';
import type { Channel } from '../../../../shared/remote-chat/protocol';
import { keyPair } from '../../../../shared/remote-chat/cipher';

afterEach(() => vi.useRealTimers());

function report() {
  return new Map<string, Record<string, unknown>>([
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['unused', { id: 'unused', type: 'candidate-pair', state: 'succeeded', nominated: true,
      localCandidateId: 'other', remoteCandidateId: 'other' }],
    ['pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', selected: true,
      localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['other', { id: 'other', type: 'local-candidate', address: '203.0.113.99', port: 9999, protocol: 'udp' }],
    ['local', { id: 'local', type: 'local-candidate', candidateType: 'host',
      address: '192.168.1.4', port: 45678, protocol: 'udp' }],
    ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'srflx',
      ip: '2001:db8::8', port: 42123, protocol: 'udp' }],
  ]);
}
const endpoints: ConnectionEndpoints = {
  local: { host: '192.168.1.4', port: 45678, protocol: 'udp' },
  remote: { host: '2001:db8::8', port: 42123, protocol: 'udp' },
};

it('reads only the selected pair, supports legacy ip fields, and keeps addresses out of diagnostics', () => {
  const stats = report(), diagnostic = vi.fn();
  expect(selectedIcePair(stats as RTCStatsReport, diagnostic)).toEqual(endpoints);
  stats.delete('transport');
  expect(selectedIcePair(stats as RTCStatsReport)).toEqual(endpoints);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/192\.168|2001:db8|203\.0\.113/);
});

it('does not substitute candidates for hidden addresses or expose TURN as a P2P endpoint', () => {
  const stats = report();
  stats.get('local')!.address = 'hidden.local';
  expect(selectedIcePair(stats as RTCStatsReport)).toEqual({ local: undefined, remote: endpoints.remote });
  stats.get('remote')!.candidateType = 'relay';
  expect(selectedIcePair(stats as RTCStatsReport)).toBeUndefined();
  stats.get('transport')!.selectedCandidatePairId = 'missing';
  expect(selectedIcePair(stats as RTCStatsReport)).toBeUndefined();
});

it('follows ICE pair changes while connected and clears stats after disconnection or close', async () => {
  vi.useFakeTimers();
  const stats = report();
  const pc = { connectionState: 'connected', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    getStats: vi.fn(async () => stats as RTCStatsReport) };
  const observer = new RtcObserver(pc as unknown as RTCPeerConnection);
  await vi.advanceTimersByTimeAsync(5000);
  expect(observer.connectionEndpoints).toEqual(endpoints);
  stats.get('remote')!.ip = '198.51.100.7';
  await vi.advanceTimersByTimeAsync(5000);
  expect(observer.connectionEndpoints?.remote?.host).toBe('198.51.100.7');
  pc.connectionState = 'disconnected';
  expect(observer.connectionEndpoints).toBeUndefined();
  observer.close();
  await vi.advanceTimersByTimeAsync(5000);
  expect(pc.getStats).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['0.0.0.0', '::', '::0', 'invalid.local', '2001:::8', '256.0.0.1', '01.2.3.4'])
('does not show an unavailable or malformed IP: %s', host => {
  expect(connectionEndpoint(host, 1234, 'udp')).toBeUndefined();
});

it('normalizes IPv6 and mapped TCP sockets and rejects missing or invalid ports', () => {
  expect(connectionEndpoint('[2001:db8::8]', 1234, 'tcp')?.host).toBe('2001:db8::8');
  expect(connectionEndpoint('::ffff:192.168.1.4', 1234, 'tcp')?.host).toBe('192.168.1.4');
  for (const port of [undefined, 0, -1, 65536, 1.2, '1234']) {
    expect(connectionEndpoint('192.168.1.4', port, 'tcp')).toBeUndefined();
  }
});

function channel(value: ConnectionEndpoints): Channel {
  let receive = (_text: string) => {};
  const reply = (text: string): string => {
    const [kind, payload] = JSON.parse(text);
    return JSON.stringify([kind === 'ping' ? 'pong' : kind, kind === 'data' ? reply(payload) : payload]);
  };
  return { readyState: 'open', bufferedAmount: 0, connectionEndpoints: value,
    onOpen() {}, onClose() {}, onMessage: callback => { receive = callback; }, close() {},
    send: text => receive(reply(text)),
  };
}

it('exposes only the selected nested path and switches its endpoints when that path fails', () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const rtc = channel(endpoints), tcp = channel({ remote: { host: '198.51.100.4', port: 2345, protocol: 'tcp' } });
  const inner = new MultipathChannel({ disconnected() {} }), outer = new MultipathChannel({ disconnected() {} });
  inner.add(rtc, 0); inner.add(tcp, 1); outer.add(inner, 0);
  expect(outer.connectionEndpoints).toEqual(endpoints);
  rtc.send = () => { throw new Error('Disconnected'); };
  vi.advanceTimersByTime(1000);
  expect(outer.connectionEndpoints).toEqual(tcp.connectionEndpoints);
  outer.close();
  expect(outer.connectionEndpoints).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it('publishes the selected link endpoints, clears on relay, and disposes polling on close', async () => {
  vi.useFakeTimers();
  const directEndpoints = vi.fn(), keys = keyPair(size => new Uint8Array(size).fill(7));
  const direct = channel(endpoints);
  const link = new ChatLink({ sessionId: 'session', desktop: false, secret: keys.secret,
    publicKey: keys.publicKey, iceServers: [], directEndpoints, signal() {}, relayBuffered: () => 0,
    mode() {}, message() {}, error() {}, createPeer: options => {
      options.channel(direct);
      return { offer: async () => {}, accept: async () => {}, close() {} };
    } });
  await vi.advanceTimersByTimeAsync(1000);
  expect(directEndpoints).toHaveBeenLastCalledWith(endpoints);
  await vi.advanceTimersByTimeAsync(1000);
  expect(directEndpoints).toHaveBeenCalledOnce();
  link.enableRelay();
  await vi.advanceTimersByTimeAsync(1000);
  expect(directEndpoints).toHaveBeenLastCalledWith(undefined);
  link.close();
  expect(vi.getTimerCount()).toBe(0);
});
