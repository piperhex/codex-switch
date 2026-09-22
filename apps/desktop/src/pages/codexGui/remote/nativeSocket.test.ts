import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke, Channel } from '@tauri-apps/api/core';
import { NativeGuiSocket } from './nativeSocket';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage = (_message: unknown) => {}; } }));
const identity = { baseUrl: 'https://cloud.example/api', userId: 'owner' };
const sockets: NativeGuiSocket[] = [];
const flush = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };
async function connect() {
  const socket = new NativeGuiSocket(identity);
  sockets.push(socket);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', deviceId: 'other', publicKey: 'ab'.repeat(32),
    role: 'mobile', accessToken: 'must-not-cross-ipc', resume: { sessionId: 'session', resumeToken: 'resume' } }));
  await flush();
  return socket;
}

beforeEach(() => { vi.mocked(invoke).mockReset().mockResolvedValue(undefined); });
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); await flush(); });

it('passes public peer identity to native authentication without forwarding credentials', async () => {
  const socket = await connect();
  expect(invoke).toHaveBeenCalledWith('gui_remote_open', { request: { clientId: socket.clientId,
    deviceId: 'other', identity, publicKey: 'ab'.repeat(32), resume: { sessionId: 'session', resumeToken: 'resume' } },
    events: expect.any(Channel) });
  expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain('must-not-cross-ipc');
  socket.send(JSON.stringify({ type: 'signal', sessionId: 'session', payload: { kind: 'key', key: 'peer' } }));
  await flush();
  expect(invoke).toHaveBeenCalledWith('gui_remote_send', { request: { clientId: socket.clientId,
    message: { type: 'signal', sessionId: 'session', payload: { kind: 'key', key: 'peer' } } } });
  expect(socket.bufferedAmount).toBe(0);
});

it('closes only the old connection when the computer changes before native open resolves', async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const old = await connect();
  old.close();
  const next = await connect();
  finish(); await flush();
  expect(invoke).toHaveBeenCalledWith('gui_remote_close', { request: { clientId: old.clientId } });
  expect(invoke).not.toHaveBeenCalledWith('gui_remote_close', { request: { clientId: next.clientId } });
  expect(next.readyState).toBe(1);
});

it('acknowledges batches and ignores late frames after a native disconnect', async () => {
  const socket = await connect();
  const { events } = vi.mocked(invoke).mock.calls[0][1] as { events: Channel<unknown> };
  socket.onmessage = vi.fn(); socket.onclose = vi.fn();
  events.onmessage({ sequence: 7, events: [{ type: 'message', data: 'first' }] });
  expect(socket.onmessage).toHaveBeenCalledWith({ data: 'first' });
  expect(invoke).toHaveBeenCalledWith('gui_remote_ack', { request: { clientId: socket.clientId, sequence: 7 } });
  events.onmessage({ sequence: 0, events: [{ type: 'closed', code: 4001 }] });
  events.onmessage({ sequence: 8, events: [{ type: 'message', data: 'stale' }] });
  expect(socket.onclose).toHaveBeenCalledWith({ code: 4001 });
  expect(socket.onmessage).toHaveBeenCalledTimes(1);
  expect(socket.readyState).toBe(3);
});

it('drains peer-close before replacing a socket so abandoned sessions do not fill the remote computer', async () => {
  const old = await connect();
  old.send(JSON.stringify({ type: 'peer-close', sessionId: 'old-session' }));
  old.close();
  const next = await connect();
  await flush();
  const calls = vi.mocked(invoke).mock.calls;
  const commands = calls.map(([command]) => command);
  expect(commands).toEqual(['gui_remote_open', 'gui_remote_send', 'gui_remote_close', 'gui_remote_open']);
  expect(calls[1][1]).toEqual({ request: { clientId: old.clientId,
    message: { type: 'peer-close', sessionId: 'old-session' } } });
  expect(next.readyState).toBe(1);
});
