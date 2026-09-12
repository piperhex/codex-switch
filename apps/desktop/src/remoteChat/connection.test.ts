import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatConnection } from '../../../../shared/remote-chat/client/connection';
import { CONNECTION_ERRORS } from '../../../../shared/remote-chat/connectionErrors';

class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
}

const session = { baseUrl: 'https://test.example', accessToken: 'test-token' };
function harness(authorize = vi.fn(async () => session)) {
  const mode = vi.fn();
  const ready = vi.fn();
  const error = vi.fn();
  const connection = new ChatConnection({ deviceId: 'pc', authorize, mode, ready, error, event: vi.fn(),
    randomBytes: (length) => new Uint8Array(length).fill(1),
    createPeer: () => ({ offer: async () => undefined, accept: async () => undefined, close() {} }),
  });
  connection.start();
  return { connection, authorize, mode, ready, error };
}

beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('retries an unresponsive handshake without waiting for the socket close event', async () => {
  const { connection, authorize } = harness();
  await vi.advanceTimersByTimeAsync(30_000);
  const first = Socket.instances[0];
  expect(first.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1500);
  expect(authorize).toHaveBeenCalledTimes(2);
  first.onclose?.({ code: 4004 });
  first.onopen?.();
  expect(first.send).not.toHaveBeenCalled();
  expect(Socket.instances[1].close).not.toHaveBeenCalled();
  connection.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores an authorization result arriving after that attempt timed out', async () => {
  let finish: (value: typeof session) => void = () => undefined;
  const authorize = vi.fn(async () => session)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { connection } = harness(authorize);
  await vi.advanceTimersByTimeAsync(31_500);
  expect(Socket.instances).toHaveLength(1);
  finish(session);
  await vi.advanceTimersByTimeAsync(0);
  expect(Socket.instances).toHaveLength(1);
  connection.stop();
});

it('cleans up after socket errors even when the platform never emits close', async () => {
  const { connection, authorize } = harness();
  await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].onerror?.();
  await vi.advanceTimersByTimeAsync(1750);
  expect(authorize).toHaveBeenCalledTimes(2);
  connection.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(authorize).toHaveBeenCalledTimes(2);
});

it('cancels all connection work when a phone leaves the chat', async () => {
  const { connection, authorize } = harness();
  connection.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(0);
  expect(authorize).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  [4001, CONNECTION_ERRORS.authorization], [4004, CONNECTION_ERRORS.unavailable],
  [4008, CONNECTION_ERRORS.limit], [1006, CONNECTION_ERRORS.network], [1012, CONNECTION_ERRORS.server],
])('shows a useful reason for socket close %s, even after an error event', async (code, message) => {
  const { connection, error } = harness();
  await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].onerror?.();
  Socket.instances[0].onclose?.({ code });
  await vi.advanceTimersByTimeAsync(250);
  expect(error).toHaveBeenCalledExactlyOnceWith(message);
  connection.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  [401, CONNECTION_ERRORS.expired], [403, CONNECTION_ERRORS.authorization], [503, CONNECTION_ERRORS.server],
])('distinguishes authorization failure %s without leaking server details', async (status, message) => {
  const { connection, error } = harness(vi.fn().mockRejectedValue({ status, message: '/private/token' }));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledWith(message);
  expect(Socket.instances).toHaveLength(0);
  connection.stop();
});

it('reports a timeout and ignores obsolete close reasons during the next attempt', async () => {
  const { connection, error } = harness();
  await vi.advanceTimersByTimeAsync(31_500);
  expect(error).toHaveBeenCalledExactlyOnceWith(CONNECTION_ERRORS.timeout);
  Socket.instances[0].onclose?.({ code: 4008 });
  expect(error).toHaveBeenCalledOnce();
  connection.stop();
});

it('recognizes the H5 login error without showing it as a network failure', async () => {
  const { connection, error } = harness(vi.fn().mockRejectedValue(new Error('登录已过期，请重新登录')));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledWith(CONNECTION_ERRORS.expired);
  connection.stop();
});

it.each([
  ['{"type":"peer-close"}', CONNECTION_ERRORS.interrupted], ['invalid json', CONNECTION_ERRORS.invalid],
])('reports a disconnected peer or invalid connection message', async (data, message) => {
  const { connection, error } = harness();
  await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].onmessage?.({ data });
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledWith(message);
  connection.stop();
});
