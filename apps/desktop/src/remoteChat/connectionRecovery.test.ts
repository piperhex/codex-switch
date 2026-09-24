import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatConnection } from '../../../../shared/remote-chat/client/connection';
import type { LinkOptions } from '../../../../shared/remote-chat/linkOptions';
import type { RpcMessage } from '../../../../shared/remote-chat/protocol';
import type { TransferProgress } from '../../../../shared/remote-chat/uploadProgress';
import { getChatPolicy, DEFAULT_CHAT_POLICY } from '../../../../shared/remote-chat/policy';

const state = vi.hoisted(() => ({ options: undefined as LinkOptions | undefined,
  send: vi.fn(async (_message: RpcMessage, _progress?: TransferProgress) => undefined), relay: vi.fn(), close: vi.fn() }));
vi.mock('../../../../shared/remote-chat/link', () => ({ ChatLink: class {
  resumable = true;
  constructor(options: LinkOptions) { state.options = options; }
  offer = async () => undefined;
  send = state.send;
  setRelayAvailable = state.relay;
  close = state.close;
} }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
  receive(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}
let connection: ChatConnection;
const mode = vi.fn();
const ready = vi.fn();
const error = vi.fn();
const upload = vi.fn();
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000); vi.clearAllMocks();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  connection = new ChatConnection({ deviceId: 'pc', mode, ready, error, upload, event: vi.fn(),
    authorize: async () => ({ baseUrl: 'https://test', accessToken: 'token' }),
    randomBytes: (size) => new Uint8Array(size).fill(1),
    createPeer: () => { throw new Error('unused'); },
  });
  connection.start();
  await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0].onopen?.();
  Socket.instances[0].receive({ type: 'paired', sessionId: 'session', resumeToken: 'ab'.repeat(32),
    transportVersion: 2, iceServers: [], expiresAt: Date.now() + 120_000 });
  state.options!.mode('direct');
});
afterEach(() => { connection.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('publishes individual image changes within one total percent and ignores replayed progress', async () => {
  const request = connection.request('request', { images: ['data:image/png;base64,YWJj'] });
  const [message, report] = state.send.mock.calls.at(-1)!;
  report?.(0.501, [{ kind: 'image', index: 0, percent: 1 }]);
  report?.(0.502, [{ kind: 'image', index: 0, percent: 2 }]);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload).toHaveBeenLastCalledWith({ phase: 'uploading', percent: 50,
    items: [{ kind: 'image', index: 0, percent: 2 }] });
  report?.(0.502, [{ kind: 'image', index: 0, percent: 2 }]);
  report?.(0.1, [{ kind: 'image', index: 0, percent: 0 }]);
  expect(upload).toHaveBeenCalledTimes(2);
  report?.(1, [{ kind: 'image', index: 0, percent: 100 }]);
  expect(upload).toHaveBeenLastCalledWith({ phase: 'confirming', percent: 100,
    items: [{ kind: 'image', index: 0, percent: 100 }] });
  if (message.kind !== 'request') throw new Error('Expected upload request');
  state.options!.message({ kind: 'response', id: message.id, data: true });
  await expect(request).resolves.toBe(true);
});

it('updates client transfer allowances before mode notifications and restores them on stop', () => {
  expect(getChatPolicy().fileUploadMaxMb).toBe(Number.MAX_SAFE_INTEGER);
  state.options!.mode('relay');
  expect(getChatPolicy().fileUploadMaxMb).toBe(DEFAULT_CHAT_POLICY.fileUploadMaxMb);
  state.options!.mode('direct');
  connection.stop();
  expect(getChatPolicy().fileUploadMaxMb).toBe(DEFAULT_CHAT_POLICY.fileUploadMaxMb);
});

it('retains pending requests, readiness and the same session while resuming a failed coordinator socket', async () => {
  const pending = connection.request('request', { operation: 'send', text: 'once' });
  const request = state.send.mock.calls[0][0] as { id: string };
  const first = Socket.instances[0];
  first.onclose?.({ code: 1006 });
  expect(state.close).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1500);
  const second = Socket.instances[1];
  second.onopen?.();
  expect(JSON.parse(second.send.mock.calls[0][0])).toMatchObject({
    resume: { sessionId: 'session', resumeToken: 'ab'.repeat(32) },
  });
  second.receive({ type: 'resumed', sessionId: 'session', expiresAt: Date.now() + 120_000 });
  first.onclose?.({ code: 4001 });
  state.options!.mode('relay');
  state.options!.message({ kind: 'response', id: request.id, data: 'accepted' });
  expect(await pending).toBe('accepted');
  expect(state.send).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  expect(state.relay).toHaveBeenLastCalledWith(true);
  expect(mode.mock.calls.flat()).not.toContain('offline');
});

it('still terminates P2P on authorization rejection or lease expiry', async () => {
  Socket.instances[0].onclose?.({ code: 4001 });
  expect(state.close).toHaveBeenCalledOnce();
  expect(mode).toHaveBeenLastCalledWith('offline');
  connection.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not cancel a stalled socket handshake timeout when the data path changes', async () => {
  Socket.instances[0].onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  const stalled = Socket.instances[1];
  state.options!.mode('relay');
  await vi.advanceTimersByTimeAsync(30_001);
  expect(stalled.close).toHaveBeenCalledOnce();
  expect(state.close).not.toHaveBeenCalled();
});

it('expires the authenticated session even when the coordinator is unreachable', async () => {
  Socket.instances[0].onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(120_001);
  expect(state.close).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalled();
});

it('explicitly releases a relay-only session on logout and ignores callbacks from old sockets', async () => {
  const first = Socket.instances[0];
  connection.stop();
  expect(first.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'peer-close', sessionId: 'session' }));
  first.onopen?.();
  first.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
