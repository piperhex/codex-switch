import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopTcpNetwork } from './tcpNetwork';

type Event = { type: string; socketId: string; localAddress?: string; localPort?: number;
  incoming?: boolean; data?: number[] };
const state = vi.hoisted(() => ({ invoke: vi.fn(), channels: [] as { onmessage: (event: Event) => void }[] }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke, Channel: class {
  onmessage = (_event: Event) => {};
  constructor() { state.channels.push(this); }
} }));
const networks: DesktopTcpNetwork[] = [];
const settle = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); state.channels = [];
  state.invoke.mockImplementation(async (command: string) => {
    if (command === 'remote_tcp_open') return 'group';
    if (command === 'remote_tcp_connect') return 'socket';
    if (command === 'remote_tcp_listen') return 45000;
  });
});
afterEach(async () => { networks.splice(0).forEach(network => network.close()); await settle(); vi.useRealTimers(); });
const emit = (event: Event) => state.channels[0].onmessage(event);
function setup() {
  const network = new DesktopTcpNetwork('session', 1); networks.push(network);
  return network;
}
const address = { host: '192.168.1.5', port: 45001, localPort: 45000, ipv6: false };

it.each(['before', 'after'])('accepts a native socket event arriving %s the command response', async order => {
  const network = setup(), received = vi.fn();
  const open = () => emit({ type: 'open', socketId: 'socket', localAddress: '192.168.1.6',
    localPort: 45000, incoming: false });
  if (order === 'before') open();
  const connecting = network.connect(address); await settle();
  if (order === 'after') open();
  const socket = await connecting;
  emit({ type: 'data', socketId: 'socket', data: [1, 2, 3] });
  socket.onData(received);
  expect(received).toHaveBeenCalledExactlyOnceWith(new Uint8Array([1, 2, 3]));
  await settle();
  expect(state.invoke).toHaveBeenCalledWith('remote_tcp_socket', {
    request: { groupId: 'group', socketId: 'socket', action: { kind: 'ack' } },
  });
});

it('cancels pending opens and timers when the session closes', async () => {
  vi.useFakeTimers();
  const network = setup();
  const connecting = network.connect(address);
  const failed = expect(connecting).rejects.toThrow('TCP path unavailable');
  await settle(); network.close(); await failed;
  expect(vi.getTimerCount()).toBe(0);
});
