import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { ChatSessions } from '@/modules/devices/chat/chat-sessions';
import type { ChatIdentity } from '@/modules/devices/chat/protocol';

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  failSend = false;
  sent: Record<string, unknown>[] = [];
  send(value: string, done?: (error?: Error) => void) {
    this.sent.push(JSON.parse(value));
    done?.(this.failSend ? new Error('Write failed') : undefined);
  }
  close() { this.readyState = 3; }
  terminate() { this.close(); }
  ws() { return this as unknown as WebSocket; }
}

function setup(version: number) {
  const record = vi.fn();
  const sessions = new ChatSessions(record);
  const pc = new Socket();
  const phone = new Socket();
  const common = { ownerId: 'owner', deviceId: 'pc', expiresAt: Date.now() + 60_000 };
  const join = (socket: Socket, role: ChatIdentity['role']) => sessions.join(socket.ws(), { ...common, role },
    { transportVersion: version, publicKey: 'aa'.repeat(32) }, []);
  join(pc, 'desktop');
  join(phone, 'mobile');
  const sessionId = phone.sent[0].sessionId;
  if (version === 1) sessions.route(phone.ws(), { type: 'relay-request', sessionId, reason: 'disconnected' });
  const frame = { type: 'relay', sessionId, payload: 'ab'.repeat(100) };
  return { sessions, record, pc, phone, frame };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([1, 2])('counts both directions once after successful relay writes (v%i)', (version) => {
  const { sessions, record, pc, phone, frame } = setup(version);
  expect(record).not.toHaveBeenCalled();
  sessions.route(phone.ws(), {
    type: 'signal', sessionId: frame.sessionId, payload: { kind: 'key', key: 'aa'.repeat(32) },
  });
  expect(record).not.toHaveBeenCalled();
  sessions.route(phone.ws(), frame);
  sessions.route(pc.ws(), frame);
  const bytes = Buffer.byteLength(JSON.stringify(frame));
  expect(record.mock.calls).toEqual([[bytes], [bytes]]);
});

it.each([1, 2])('excludes invalid, unauthorized, closed, slow and failed sends (v%i)', (version) => {
  const { sessions, record, pc, phone, frame } = setup(version);
  expect(() => sessions.route(new Socket().ws(), frame)).toThrow();
  expect(() => sessions.route(phone.ws(), { ...frame, payload: 'not ciphertext' })).toThrow();
  pc.failSend = true;
  sessions.route(phone.ws(), frame);
  expect(pc.readyState).toBe(3);
  sessions.route(phone.ws(), frame);
  pc.readyState = 1;
  pc.failSend = false;
  pc.bufferedAmount = 3 * 1024 * 1024;
  sessions.route(phone.ws(), frame);
  expect(record).not.toHaveBeenCalled();
});

it('excludes late frames after a resumable session has expired', () => {
  const { sessions, record, phone, frame } = setup(2);
  vi.advanceTimersByTime(60_001);
  sessions.route(phone.ws(), frame);
  expect(record).not.toHaveBeenCalled();
});
