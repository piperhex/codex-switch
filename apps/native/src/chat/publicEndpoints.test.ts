import { expect, it, vi } from 'vitest';
import { PublicEndpointObserver } from '../../../../shared/remote-chat/publicEndpointObserver';
import { formatPublicEndpoint, MAX_PUBLIC_ENDPOINTS, signalPublicEndpoints,
  type ConnectionPublicEndpoints } from '../../../../shared/remote-chat/publicEndpoints';
import type { PeerOptions, Signal } from '../../../../shared/remote-chat/protocol';
import { ChatController } from '../../../../shared/remote-chat/client/controller';

function ice(host = '203.0.113.8', port = 42123, type = 'srflx'): Signal & { kind: 'ice' } {
  return { kind: 'ice', candidate: `candidate:1 1 udp 1 ${host} ${port} typ ${type}`,
    sdpMid: '0', sdpMLineIndex: 0 };
}

it('extracts both IP families and preserves the observed port and protocol', () => {
  const ipv4 = { host: '203.0.113.8', port: 443, protocol: 'udp' };
  expect(signalPublicEndpoints(ice(ipv4.host, ipv4.port))).toEqual([ipv4]);
  const ipv6 = { host: '2001:db8::8', port: 42123, protocol: 'udp' as const };
  const sdp = ['v=0', `a=${ice(ipv4.host, ipv4.port).candidate}`, `a=${ice(ipv6.host).candidate}`].join('\r\n');
  expect(signalPublicEndpoints({ kind: 'sdp', sdp })).toEqual([ipv4, ipv6]);
  expect(formatPublicEndpoint(ipv6)).toBe('[2001:db8::8]:42123 · UDP');
  expect(signalPublicEndpoints({ kind: 'tcp', addresses: [
    { host: '192.168.1.4', port: 42000 }, { host: ipv6.host, port: 42001 },
  ] })).toEqual([{ host: ipv6.host, port: 42001, protocol: 'tcp' }]);
});

it.each(['10.1.2.3', '172.16.1.1', '192.168.1.1', '100.64.1.1', '127.0.0.1', '169.254.1.1',
  '198.18.0.1', '0.0.0.0', '224.0.0.1', '256.1.1.1', '203.000.113.8', 'device.local',
  '::1', '::', 'fc00::1', 'fe80::1', 'ff00::1', '2001:::8', '2001:db8::8%eth0', '2001:db8:8',
])('excludes non-public and malformed addresses: %s', host => {
  expect(signalPublicEndpoints(ice(host))).toEqual([]);
});

it('does not mislabel relay addresses or accept malformed signals and ports', () => {
  expect(signalPublicEndpoints(ice('203.0.113.8', 42123, 'relay'))).toEqual([]);
  const candidate = 'candidate:1 1 tcp 1 2001:db8::8 9 typ host tcptype active';
  expect(signalPublicEndpoints({ kind: 'ice', candidate })).toEqual([]);
  for (const port of [0, -1, 65536, 1.5, Number.NaN]) expect(signalPublicEndpoints(ice('203.0.113.8', port))).toEqual([]);
  for (const signal of [null, {}, { kind: 'tcp', addresses: [null, { host: 123, port: '443' }] }]) {
    expect(signalPublicEndpoints(signal)).toEqual([]);
  }
});

function observedPeer() {
  const changed = vi.fn<(value: ConnectionPublicEndpoints) => void>();
  const observer = new PublicEndpointObserver(changed);
  const options: PeerOptions[] = [];
  const accept = vi.fn(async () => undefined);
  const create = observer.wrap(value => {
    options.push(value);
    return { offer: async () => undefined, accept, close() {} };
  });
  const outgoing = vi.fn();
  const next = () => create({ iceServers: [], signal: outgoing, channel() {}, disconnected() {} });
  return { changed, observer, options, outgoing, accept, next };
}

it('updates both ends without duplicates, retaining facts over relay and clearing stale generations', async () => {
  const { changed, observer, options, outgoing, accept, next } = observedPeer();
  const first = next();
  options[0].signal(ice());
  options[0].signal(ice());
  expect(changed).toHaveBeenCalledTimes(1);
  expect(outgoing).toHaveBeenCalledTimes(2);
  const remote = ice('198.51.100.9', 51000);
  await first.accept(remote);
  expect(accept).toHaveBeenCalledWith(remote);
  expect(changed.mock.lastCall?.[0]).toEqual({
    local: [{ host: '203.0.113.8', port: 42123, protocol: 'udp' }],
    remote: [{ host: '198.51.100.9', port: 51000, protocol: 'udp' }],
  });
  first.close();
  expect(changed.mock.lastCall?.[0].local).toHaveLength(1);
  next();
  expect(changed.mock.lastCall?.[0]).toEqual({ local: [], remote: [] });
  options[0].signal(ice('203.0.113.99'));
  await first.accept(remote);
  expect(changed).toHaveBeenCalledTimes(3);
  options[1].signal(ice('203.0.113.10'));
  observer.reset();
  options[1].signal(ice());
  expect(changed.mock.lastCall?.[0]).toEqual({ local: [], remote: [] });
});

it('bounds the number of rendered addresses and publishes connection facts to chat state', () => {
  const { changed, options, next } = observedPeer();
  next();
  for (let port = 42000; port < 42100; port++) options[0].signal(ice('203.0.113.8', port));
  const publicEndpoints = changed.mock.lastCall![0];
  expect(publicEndpoints.local).toHaveLength(MAX_PUBLIC_ENDPOINTS);
  const controller = new ChatController(events => {
    return { start() { events.publicEndpoints?.(publicEndpoints); }, stop() {},
      request: async <T>() => ({} as T) };
  });
  controller.start();
  expect(controller.snapshot().publicEndpoints).toEqual(publicEndpoints);
  controller.stop();
});
