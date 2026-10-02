import { createServer, type ListenOptions, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { NativeTcpNetwork } from './tcpNetwork';
import { TcpPeer } from '../../../../shared/remote-chat/tcp/peer';
import type { TcpSignal } from '../../../../shared/remote-chat/tcp/types';
import type { Channel } from '../../../../shared/remote-chat/protocol';

const mapping = vi.hoisted(() => new Map<number, number>());
vi.mock('react-native', () => ({ NativeModules: {} }));
// Node/Windows cannot share listener ports. Simulate this NAT mapping here; the Java device test
// exercises the actual Android SO_REUSEPORT implementation with the same listening/source port.
vi.mock('react-native-tcp-socket', async () => {
  const net = await import('node:net');
  return { default: { ...net, createServer: (accept: (socket: Socket) => void) => {
    const server = net.createServer(accept);
    const listen = server.listen.bind(server);
    // Port reuse is simulated below; Node rejects native reusePort listeners on Windows.
    server.listen = ((options: ListenOptions, callback?: () => void) => {
      expect(options.reusePort).toBe(true);
      return listen({ ...options, reusePort: false }, callback);
    }) as typeof server.listen;
    return server;
  }, createConnection: (options: {
    localPort: number; host: string; port: number; reusePort: boolean;
  }, callback: () => void) => {
    expect(options.reusePort).toBe(true);
    const socket = net.createConnection({ ...options, localPort: 0 }, callback);
    socket.once('connect', () => mapping.set(socket.localPort!, options.localPort));
    return socket;
  } } };
});

function binding(socket: Socket, request: Buffer) {
  const response = Buffer.alloc(32);
  request.copy(response, 0, 0, 20);
  response.writeUInt16BE(0x101, 0); response.writeUInt16BE(12, 2);
  response.writeUInt16BE(0x20, 20); response.writeUInt16BE(8, 22); response[25] = 1;
  response.writeUInt16BE(mapping.get(socket.remotePort!)! ^ 0x2112, 26);
  socket.remoteAddress!.split('.').map(Number).forEach((byte, index) => {
    response[28 + index] = byte ^ request[4 + index];
  });
  socket.write(response.subarray(0, 9)); socket.write(response.subarray(9));
}

it('coordinates discovery and exchanges authenticated data over real TCP with a simulated port mapping', async () => {
  const failures: unknown[] = [];
  class Network extends NativeTcpNetwork {
    override async connect(address: Parameters<NativeTcpNetwork['connect']>[0]) {
      try { return await super.connect(address); } catch (error) { failures.push(error); throw error; }
    }
  }
  const host = Object.values(networkInterfaces()).flat().find(address => address?.family === 'IPv4'
    && !address.internal)?.address;
  expect(host, 'a local IPv4 interface is required').toBeTruthy();
  const connections = new Set<Socket>();
  const discovery = createServer(socket => {
    connections.add(socket); socket.on('close', () => connections.delete(socket));
    socket.on('error', () => socket.destroy());
    let request = Buffer.alloc(0);
    socket.on('data', bytes => {
      request = Buffer.concat([request, typeof bytes === 'string' ? Buffer.from(bytes) : bytes]);
      if (request.length === 20) binding(socket, request);
    });
  });
  await new Promise<void>(resolve => discovery.listen(0, '0.0.0.0', resolve));
  const address = discovery.address();
  if (!address || typeof address === 'string') throw new Error('No discovery listener');
  const peers: TcpPeer[] = [], signals: TcpSignal[][] = [[], []], channels: Channel[][] = [[], []];
  try {
    for (const side of [0, 1]) peers.push(new TcpPeer({ sessionId: 'integration-session', desktop: side === 0,
      config: { servers: [{ host: host!, port: address.port }] }, random: randomBytes,
      signal: signal => { signals[side].push(signal); peers[1 - side]?.accept(signal); },
      channel: channel => channels[side].push(channel) }, new Network()));
    signals[0].forEach(signal => peers[1].accept(signal));
    await vi.waitFor(() => expect(channels.every(paths => paths.some(path => path.readyState === 'open')),
      JSON.stringify({ failures: failures.map(String), signals })).toBe(true), { timeout: 4000 });
    const received = vi.fn(); channels[1].forEach(channel => channel.onMessage(received));
    channels[0].find(channel => channel.readyState === 'open')!.send('real TCP payload');
    await vi.waitFor(() => expect(received).toHaveBeenCalledExactlyOnceWith('real TCP payload'));
    for (const paths of channels) {
      const endpoints = paths.find(path => path.readyState === 'open')!.connectionEndpoints;
      expect(endpoints?.local).toEqual({ host, port: expect.any(Number), protocol: 'tcp' });
      expect(endpoints?.remote).toEqual({ host, port: expect.any(Number), protocol: 'tcp' });
    }
    expect(signals.every(values => values.some(value => value.addresses.length > 0))).toBe(true);
  } finally {
    peers.forEach(peer => peer.close()); connections.forEach(socket => socket.destroy()); mapping.clear();
    await new Promise<void>(resolve => discovery.close(() => resolve()));
  }
  expect(channels.flat().every(channel => channel.readyState === 'closed')).toBe(true);
});
