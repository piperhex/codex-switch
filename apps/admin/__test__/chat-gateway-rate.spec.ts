import { EventEmitter } from 'events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { ChatGateway } from '@/modules/devices/chat/chat.gateway';
import type { ChatAuthService } from '@/modules/devices/chat/chat-auth.service';
import type { ChatStunService } from '@/modules/devices/chat/stun.service';
import type { ChatSettingsService } from '@/modules/chat-settings/chat-settings.service';
import type { ChatTrafficService } from '@/modules/chat-traffic/chat-traffic.service';
import { DEFAULT_CHAT_POLICY, type ChatPolicy } from '@/modules/chat-settings/chat-policy';

class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  send(text: string, done?: () => void) { this.sent.push(JSON.parse(text)); done?.(); }
  close() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  terminate() { this.close(); }
  ping() { this.emit('pong'); }
  receive(message: object) { this.emit('message', Buffer.from(JSON.stringify(message)), false); }
}

let gateway: ChatGateway;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { gateway?.onModuleDestroy(); vi.useRealTimers(); });

async function connected(initial: Partial<ChatPolicy> = {}) {
  let policy = { ...DEFAULT_CHAT_POLICY, ...initial };
  const auth = { authenticate: async (message: { role: string }) => ({ ownerId: 'owner', deviceId: 'pc',
    role: message.role, expiresAt: Date.now() + 3600000 }) };
  const settings = { read: async () => policy };
  const record = vi.fn();
  gateway = new ChatGateway(auth as unknown as ChatAuthService,
    { iceServers: () => [] } as unknown as ChatStunService, settings as unknown as ChatSettingsService,
    { record } as unknown as ChatTrafficService);
  const pc = new Socket();
  const phone = new Socket();
  for (const [socket, role] of [[pc, 'desktop'], [phone, 'mobile']] as const) {
    gateway.handleConnection(socket as unknown as WebSocket);
    socket.receive({ role, publicKey: '11'.repeat(32) });
    await vi.advanceTimersByTimeAsync(0);
  }
  const sessionId = pc.sent.find((message) => message.type === 'peer-open')!.sessionId;
  await vi.advanceTimersByTimeAsync(11000);
  phone.receive({ type: 'relay-request', sessionId, reason: 'timeout' });
  await vi.advanceTimersByTimeAsync(1000);
  return { pc, phone, record, send: (payload = 'ab') => pc.receive({ type: 'relay', sessionId, payload }),
    policy: (patch: Partial<ChatPolicy>) => { policy = { ...policy, ...patch }; } };
}

it('forwards bursts beyond both old per-second limits by default', async () => {
  const harness = await connected();
  for (let index = 0; index < 500; index++) harness.send('ab'.repeat(5000));
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.pc.readyState).toBe(WebSocket.OPEN);
  expect(harness.phone.sent.filter((message) => message.type === 'relay')).toHaveLength(500);
  expect(harness.record).toHaveBeenCalledTimes(500);
  expect(harness.record.mock.calls.reduce((total, [bytes]) => total + Number(bytes), 0)).toBe(
    harness.phone.sent.filter((message) => message.type === 'relay')
      .reduce((total, message) => total + Buffer.byteLength(JSON.stringify(message)), 0),
  );
});

it.each([
  { relayMaxFramesPerSecond: 2 }, { relayMaxMbPerSecond: 1 },
])('enforces only a configured positive limit: %o', async (policy) => {
  const harness = await connected(policy);
  for (let index = 0; index < 40; index++) harness.send('ab'.repeat(15000));
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.pc.readyState).toBe(WebSocket.CLOSED);
});

it('applies changed settings to existing connections and can return to unlimited', async () => {
  const harness = await connected({ relayMaxFramesPerSecond: 2 });
  harness.send();
  harness.send();
  harness.policy({ relayMaxFramesPerSecond: -1 });
  await vi.advanceTimersByTimeAsync(5000);
  for (let index = 0; index < 500; index++) harness.send();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.pc.readyState).toBe(WebSocket.OPEN);
  harness.policy({ relayMaxFramesPerSecond: 2 });
  await vi.advanceTimersByTimeAsync(5000);
  harness.send();
  harness.send();
  harness.send();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.pc.readyState).toBe(WebSocket.CLOSED);
});
