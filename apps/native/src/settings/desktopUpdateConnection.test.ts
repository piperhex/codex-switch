import { afterEach, expect, it, vi } from 'vitest';
import { DesktopUpdateConnection, type UpdateSocket } from '../../../../shared/desktop-update/connection';
import { parseUpdateStatus, type DesktopUpdateStatus } from '../../../../shared/desktop-update/protocol';

const status: DesktopUpdateStatus = { currentVersion: '1.0.0', latestVersion: '2.0.0',
  notes: null, phase: 'available', progress: null, error: null };
const computer = (deviceId = 'pc', supported = true) => ({ deviceId, name: deviceId, online: true,
  platform: 'windows', capabilities: supported ? ['app-update'] : [], appVersion: '1.0.0' });
class Socket implements UpdateSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close = vi.fn();
  receive(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  result(data = status) {
    this.receive({ type: 'app-update-result', requestId: this.sent.at(-1)?.requestId, data });
  }
}
const active: DesktopUpdateConnection[] = [];
async function setup(devices = [computer()]) {
  const sockets: Socket[] = [];
  const connection = new DesktopUpdateConnection({
    authorize: async () => ({ baseUrl: 'https://example.com/api', accessToken: 'test-token' }),
    createSocket: (url) => {
      expect(url).toBe('wss://example.com/api/device-switch');
      const socket = new Socket(); sockets.push(socket); return socket;
    },
  });
  active.push(connection); connection.start(); await Promise.resolve();
  const socket = sockets[0]; socket.onopen?.();
  socket.receive({ type: 'devices-snapshot', devices });
  return { connection, socket, sockets };
}
afterEach(() => { active.splice(0).forEach((connection) => connection.stop()); vi.useRealTimers(); });

it('subscribes over WS, reads the running version and rejects mismatched replies', async () => {
  const { connection, socket } = await setup();
  expect(socket.sent[0]).toMatchObject({ type: 'subscribe-devices', accessToken: 'test-token' });
  expect(socket.sent[1]).toMatchObject({ type: 'app-update', deviceId: 'pc', action: 'status' });
  socket.receive({ type: 'app-update-result', requestId: 'wrong', data: status });
  expect(connection.snapshot().status).toBeNull();
  socket.result(); expect(connection.snapshot().status?.currentVersion).toBe('1.0.0');
});

it('keeps requests single-flight and never sends installation to an offline or legacy desktop', async () => {
  const { connection, socket } = await setup([computer(), computer('old', false)]);
  connection.request('check'); expect(socket.sent).toHaveLength(2);
  socket.result(); connection.select('old'); connection.request('install', '2.0.0');
  expect(socket.sent).toHaveLength(2);
  connection.select('pc'); socket.result();
  socket.receive({ type: 'device-offline', deviceId: 'pc' });
  connection.request('install', '2.0.0'); expect(socket.sent).toHaveLength(3);
});

it('ignores an old computer response after selection changes and reads the new computer', async () => {
  const { connection, socket } = await setup([computer(), computer('other')]);
  connection.select('other'); socket.result();
  expect(connection.snapshot().status).toBeNull();
  expect(socket.sent.at(-1)).toMatchObject({ deviceId: 'other', action: 'status' });
  socket.result({ ...status, currentVersion: '3.0.0' });
  expect(connection.snapshot().status?.currentVersion).toBe('3.0.0');
});

it('does not replay installation on reconnect and confirms success only from the running version', async () => {
  vi.useFakeTimers();
  const { connection, socket, sockets } = await setup(); socket.result();
  connection.request('install', '2.0.0'); socket.result({ ...status, phase: 'downloading' });
  socket.onclose?.(); await vi.advanceTimersByTimeAsync(3_000);
  const reconnected = sockets[1]; reconnected.onopen?.();
  reconnected.receive({ type: 'devices-snapshot', devices: [computer()] });
  expect(reconnected.sent.at(-1)?.action).toBe('status');
  reconnected.result(); expect(connection.snapshot().updated).toBe(false);
  connection.request('status'); reconnected.result({ ...status, currentVersion: '2.0.0' });
  expect(connection.snapshot().updated).toBe(true);
  expect(reconnected.sent.some((request) => request.action === 'install')).toBe(false);
});

it('times out without reporting installation success and cancels timers when closed', async () => {
  vi.useFakeTimers();
  const { connection, socket } = await setup(); socket.result();
  connection.request('install', '2.0.0'); await vi.advanceTimersByTimeAsync(45_000);
  expect(connection.snapshot()).toMatchObject({ busy: false, updated: false });
  expect(connection.snapshot().error).toContain('暂未响应');
  const count = socket.sent.length; connection.stop(); await vi.advanceTimersByTimeAsync(60_000);
  expect(socket.sent).toHaveLength(count);
});

it('validates status fields instead of showing malformed update data', () => {
  expect(parseUpdateStatus({ ...status, progress: 101 })).toBeNull();
  expect(parseUpdateStatus({ ...status, phase: 'completed' })).toBeNull();
  expect(parseUpdateStatus(status)).toEqual(status);
});

it('preserves an offline event racing the first snapshot and ignores socket events after stop', async () => {
  const { connection, socket, sockets } = await setup(); socket.result();
  vi.useFakeTimers(); socket.onclose?.(); await vi.advanceTimersByTimeAsync(3_000);
  const next = sockets[1];
  next.receive({ type: 'device-offline', deviceId: 'pc' });
  next.receive({ type: 'devices-snapshot', devices: [computer()] });
  expect(connection.snapshot().devices[0].online).toBe(false);
  connection.stop(); next.onopen?.();
  expect(next.sent).toHaveLength(0);
});
