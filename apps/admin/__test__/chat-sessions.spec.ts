import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { ChatSessions } from '@/modules/devices/chat/chat-sessions';
import { ChatAuthService } from '@/modules/devices/chat/chat-auth.service';
import { ChatGateway } from '@/modules/devices/chat/chat.gateway';
import { bindingResponse, ChatStunService } from '@/modules/devices/chat/stun.service';
import type { ChatIdentity } from '@/modules/devices/chat/protocol';
import type { JwtService } from '@nestjs/jwt';
import type { UserService } from '@/modules/user/user.service';
import type { DeviceControlService } from '@/modules/devices/device-control.service';
import type { ConfigModuleOptions } from '@/config/config.types';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  send(value: string, callback?: (error?: Error) => void) { this.sent.push(JSON.parse(value)); callback?.(); }
  close = vi.fn(() => { this.readyState = 3; this.emit('close'); });
  terminate = this.close;
  ping = vi.fn();
  ws() { return this as unknown as WebSocket; }
}

function identity(role: ChatIdentity['role'], ownerId = 'owner'): ChatIdentity {
  return { role, ownerId, deviceId: 'computer', expiresAt: Date.now() + 60_000 };
}
function pair(sessions = new ChatSessions()) {
  const pc = new Socket();
  const phone = new Socket();
  sessions.join(pc.ws(), identity('desktop'), {}, []);
  sessions.join(phone.ws(), identity('mobile'), { publicKey: 'ab'.repeat(32) }, []);
  const sessionId = String(phone.sent[0].sessionId);
  return { sessions, pc, phone, sessionId };
}
afterEach(() => vi.useRealTimers());

describe('chat rendezvous and relay', () => {
  it('pairs only the same owner and blocks a third socket from routing session frames', () => {
    const { sessions, pc, phone, sessionId } = pair();
    const stranger = new Socket();
    sessions.join(stranger.ws(), identity('mobile', 'other-owner'), { publicKey: 'ab'.repeat(32) }, []);
    expect(stranger.close).toHaveBeenCalled();
    expect(pc.sent).toHaveLength(2);
    expect(() => sessions.route(stranger.ws(), { type: 'relay-request', sessionId })).toThrow();
    sessions.route(phone.ws(), { type: 'signal', sessionId, payload: { kind: 'sdp', type: 'offer', sdp: 'v=0' } });
    expect(pc.sent.at(-1)).toMatchObject({ type: 'signal', sessionId });
  });

  it('waits for direct attempts, then forwards ciphertext without interpreting chat contents', () => {
    vi.useFakeTimers();
    const { sessions, pc, phone, sessionId } = pair();
    expect(() => sessions.route(phone.ws(), { type: 'relay-request', sessionId, reason: 'timeout' })).toThrow();
    expect(() => sessions.route(phone.ws(), { type: 'relay', sessionId, payload: 'ab' })).toThrow();
    vi.advanceTimersByTime(10_001);
    sessions.route(phone.ws(), { type: 'relay-request', sessionId, reason: 'timeout' });
    sessions.route(phone.ws(), { type: 'relay', sessionId, payload: 'ab'.repeat(100) });
    expect(pc.sent.at(-1)).toEqual({ type: 'relay', sessionId, payload: 'ab'.repeat(100) });
    expect(() => sessions.route(phone.ws(), { type: 'relay', sessionId, payload: 'plaintext message' })).toThrow();
  });

  it('invalidates old sessions on disconnect or desktop replacement and bounds connection fan-out', () => {
    const { sessions, pc, phone, sessionId } = pair();
    for (let index = 0; index < 3; index++) {
      sessions.join(new Socket().ws(), identity('mobile'), { publicKey: 'aa'.repeat(32) }, []);
    }
    const overflow = new Socket();
    sessions.join(overflow.ws(), identity('mobile'), { publicKey: 'aa'.repeat(32) }, []);
    expect(overflow.close).toHaveBeenCalled();
    sessions.join(new Socket().ws(), identity('desktop'), {}, []);
    expect(pc.close).toHaveBeenCalled();
    expect(phone.sent.at(-1)).toMatchObject({ type: 'peer-close' });
    expect(() => sessions.route(phone.ws(), { type: 'relay-request', sessionId })).toThrow();
  });

  it('rejects slow relay consumers instead of accumulating an unbounded send queue', () => {
    const { sessions, pc, phone, sessionId } = pair();
    pc.bufferedAmount = 3 * 1024 * 1024;
    sessions.route(phone.ws(), { type: 'signal', sessionId, payload: { kind: 'key', key: 'ab'.repeat(32) } });
    expect(pc.close).toHaveBeenCalled();
  });
});

describe('chat authentication lifecycle', () => {
  it('requires an active user, an unexpired signed token and an owned device', async () => {
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'owner', exp: Date.now() / 1000 + 1000 }) };
    const users = { findActiveById: vi.fn().mockResolvedValue({ id: 'owner' }) };
    const devices = { getOwned: vi.fn().mockResolvedValue({ deviceId: 'computer' }) };
    const auth = new ChatAuthService(jwt as unknown as JwtService, users as unknown as UserService,
      devices as unknown as DeviceControlService, { KONG_JWT_SECRET: 'test' } as ConfigModuleOptions);
    const input = { type: 'authenticate', accessToken: 'token', role: 'mobile', deviceId: 'computer' };
    expect(await auth.authenticate(input)).toMatchObject({ ownerId: 'owner', role: 'mobile' });
    expect(devices.getOwned).toHaveBeenCalledWith('owner', 'computer');
    devices.getOwned.mockRejectedValueOnce(new Error('Not owned'));
    await expect(auth.authenticate(input)).rejects.toThrow();
    users.findActiveById.mockResolvedValueOnce(null);
    await expect(auth.authenticate(input)).rejects.toThrow();
    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'owner', exp: 0 });
    await expect(auth.authenticate(input)).rejects.toThrow();
  });

  it('expires authenticated sockets and does not admit a socket closed during authentication', async () => {
    vi.useFakeTimers();
    let finish: (identity: ChatIdentity) => void = () => undefined;
    const auth = { authenticate: vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })) };
    const gateway = new ChatGateway(auth as unknown as ChatAuthService, new ChatStunService());
    const socket = new Socket();
    gateway.handleConnection(socket.ws());
    socket.emit('message', Buffer.from('{"type":"authenticate"}'), false);
    socket.close();
    finish(identity('desktop'));
    await Promise.resolve();
    expect(socket.sent).toHaveLength(0);
    const active = new Socket();
    auth.authenticate.mockResolvedValueOnce({ ...identity('desktop'), expiresAt: Date.now() + 2000 });
    gateway.handleConnection(active.ws());
    active.emit('message', Buffer.from('{"type":"authenticate"}'), false);
    await Promise.resolve();
    expect(active.sent).toContainEqual({ type: 'registered' });
    await vi.advanceTimersByTimeAsync(2001);
    expect(active.close).toHaveBeenCalled();
    gateway.onModuleDestroy();
  });
});

it('returns an RFC 8489 XOR-mapped address with the original transaction id', () => {
  const request = Buffer.alloc(20);
  request.writeUInt16BE(1, 0);
  request.writeUInt32BE(0x2112a442, 4);
  request.fill(0x5a, 8);
  const response = bindingResponse(request, '203.0.113.10', 45678)!;
  expect(response.length).toBe(32);
  expect(response.readUInt16BE(0)).toBe(0x101);
  expect(response.subarray(8, 20)).toEqual(request.subarray(8, 20));
  expect(response.readUInt16BE(26) ^ 0x2112).toBe(45678);
  expect([...response.subarray(28)].map((byte, index) => byte ^ response[4 + index])).toEqual([203, 0, 113, 10]);
  expect(bindingResponse(Buffer.alloc(19), '203.0.113.10', 42)).toBeNull();
  expect(bindingResponse(request, '::1', 42)).toBeNull();
  request.writeUInt16BE(4, 2);
  expect(bindingResponse(request, '203.0.113.10', 42)).toBeNull();
});
