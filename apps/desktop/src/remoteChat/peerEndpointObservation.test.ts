import { expect, it } from 'vitest';
import { PeerEndpointObservation } from '../../../../shared/remote-chat/peerEndpointObservation';
import type { Channel } from '../../../../shared/remote-chat/protocol';
import type { ConnectionEndpoints } from '../../../../shared/remote-chat/connectionEndpoints';

const publicEndpoint = { host: '203.0.113.8', port: 42123, protocol: 'udp' as const };

function setup() {
  const endpoints: ConnectionEndpoints = {
    local: { host: '172.19.0.1', port: 47894, protocol: 'udp' },
    remote: { host: '198.51.100.8', port: 46184, protocol: 'udp' },
  };
  const channel: Channel = { readyState: 'open', bufferedAmount: 0, connectionEndpoints: endpoints,
    send() {}, close() {}, onOpen() {}, onClose() {}, onMessage() {} };
  const observation = new PeerEndpointObservation();
  const route = observation.capture(channel);
  return { endpoints, channel, observation, route };
}

it('keeps the socket address and the peer-confirmed public mapping separate', () => {
  const { channel, route, observation, endpoints } = setup();
  observation.confirm({ channel, route, id: 1, endpoint: publicEndpoint });
  expect(observation.read(channel)).toEqual({ ...endpoints, localPublic: publicEndpoint });
});

it.each([
  undefined, null, '203.0.113.8:42123', { ...publicEndpoint, port: 0 },
  { ...publicEndpoint, port: '42123' }, { ...publicEndpoint, protocol: 'tcp' },
  ...['172.19.0.1', '100.64.0.1', '198.18.0.1', '127.0.0.1', 'hidden.local', '::', 'fd00::8', 'fe80::8']
    .map(host => ({ ...publicEndpoint, host })),
])('does not retain a public mapping after an unavailable, private or invalid observation: %j', endpoint => {
  const { channel, route, observation, endpoints } = setup();
  observation.confirm({ channel, route, id: 1, endpoint: publicEndpoint });
  observation.confirm({ channel, route, id: 2, endpoint });
  expect(observation.read(channel)).toEqual(endpoints);
});

it('accepts public IPv6 and ignores older replies', () => {
  const { channel, route, observation } = setup();
  const endpoint = { ...publicEndpoint, host: '2001:db8::8' };
  observation.confirm({ channel, route, id: 2, endpoint });
  observation.confirm({ channel, route, id: 1, endpoint: publicEndpoint });
  expect(observation.read(channel)?.localPublic).toEqual(endpoint);
});

it('invalidates mappings and delayed replies when the route changes, even on the same channel', () => {
  const { channel, route, observation, endpoints } = setup();
  observation.confirm({ channel, route, id: 1, endpoint: publicEndpoint });
  endpoints.remote = { ...endpoints.remote!, port: 54321 };
  expect(observation.read(channel)?.localPublic).toBeUndefined();
  observation.confirm({ channel, route, id: 2, endpoint: publicEndpoint });
  expect(observation.read(channel)?.localPublic).toBeUndefined();
  const current = observation.capture(channel);
  observation.confirm({ channel, route: current, id: 3, endpoint: publicEndpoint });
  expect(observation.read(channel)?.localPublic).toEqual(publicEndpoint);
  expect(observation.read({ ...channel })?.localPublic).toBeUndefined();
});

it('clears observations and rejects outstanding replies across reconnects', () => {
  const { channel, route, observation } = setup();
  observation.confirm({ channel, route, id: 1, endpoint: publicEndpoint });
  observation.clear();
  observation.confirm({ channel, route, id: 2, endpoint: publicEndpoint });
  expect(observation.read(channel)?.localPublic).toBeUndefined();
});
