// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';
import { ChatHost } from './host';
import { mobileConnection } from './mobileConnection';
import { DEFAULT_CHAT_POLICY, getChatPolicy, setChatPolicy } from '../../../../shared/remote-chat/policy';
import type { HostTransportEvent } from './nativeTransport';

const links = vi.hoisted(() => new Map<string, { mode: (mode: ConnectionMode) => void; close: () => void }>());
const native = vi.hoisted(() => ({ receive: undefined as ((event: HostTransportEvent) => void) | undefined }));
vi.mock('./nativeTransport', () => ({ NativeChatTransport: class {
  ready = true; bufferedAmount = 0;
  constructor(receive: (event: HostTransportEvent) => void) { native.receive = receive; }
  send = vi.fn(); forgetSession = vi.fn(); reconnect = vi.fn(); close = vi.fn();
} }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { subscribe: vi.fn(async () => vi.fn()) } }));
vi.mock('../pages/codexGui/webEvents', () => ({ subscribeGuiEvent: vi.fn(async () => vi.fn()) }));
vi.mock('./operations', () => ({ ChatOperations: class {} }));
vi.mock('../../../../shared/remote-chat/link', () => ({ ChatLink: class {
  private closed = false;
  constructor(private options: { sessionId: string; mode: (mode: ConnectionMode) => void }) {
    links.set(options.sessionId, { mode: options.mode, close: () => this.close() });
  }
  enableRelay() { this.options.mode('relay'); }
  setRelayAvailable(available: boolean) { if (!available) this.close(); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.options.mode('offline');
  }
} }));

let host: ChatHost;
const message = (data: object) => native.receive!({ type: 'message', generation: 1, data: JSON.stringify(data) });

beforeEach(() => {
  links.clear();
  mobileConnection.setConnected(false);
  host = new ChatHost(mobileConnection.setConnected);
});
afterEach(() => { host.close(); setChatPolicy(DEFAULT_CHAT_POLICY); vi.unstubAllGlobals(); });

it('accepts configuration from the coordinator before pairing and while a direct session is active', async () => {
  const policy = { ...DEFAULT_CHAT_POLICY, threadPageSize: 6 };
  message({ type: 'chat-policy', policy });
  expect(getChatPolicy().threadPageSize).toBe(6);
  await receive('peer-open', 'phone');
  links.get('phone')!.mode('direct');
  message({ type: 'chat-policy', policy: { ...policy, threadPageSize: 9 } });
  expect(getChatPolicy().threadPageSize).toBe(9);
  expect(mobileConnection.getSnapshot()).toBe(true);
});

async function receive(type: string, sessionId: string) {
  message({ type, sessionId, publicKey: 'test', iceServers: [] });
  await Promise.resolve();
}

it('accepts more than four admitted sessions and keeps them when the policy limit decreases', async () => {
  message({ type: 'chat-policy', policy: { ...DEFAULT_CHAT_POLICY, chatSessionLimit: 8 } });
  for (let index = 0; index < 8; index++) {
    await receive('peer-open', `phone-${index}`);
    links.get(`phone-${index}`)!.mode('direct');
  }
  expect(links.size).toBe(8);
  message({ type: 'chat-policy', policy: { ...DEFAULT_CHAT_POLICY, chatSessionLimit: 1 } });
  expect(mobileConnection.getSnapshot()).toBe(true);
  for (let index = 0; index < 7; index++) await receive('peer-close', `phone-${index}`);
  expect(mobileConnection.getSnapshot()).toBe(true);
  await receive('peer-close', 'phone-7');
  expect(mobileConnection.getSnapshot()).toBe(false);
});

it('stays disconnected until transport is ready and follows reconnects and peer closure', async () => {
  expect(mobileConnection.getSnapshot()).toBe(false);
  await receive('peer-open', 'phone');
  expect(mobileConnection.getSnapshot()).toBe(false);
  links.get('phone')!.mode('direct');
  expect(mobileConnection.getSnapshot()).toBe(true);
  links.get('phone')!.mode('connecting');
  expect(mobileConnection.getSnapshot()).toBe(false);
  await receive('relay-ready', 'phone');
  expect(mobileConnection.getSnapshot()).toBe(true);
  await receive('peer-close', 'phone');
  expect(mobileConnection.getSnapshot()).toBe(false);
});

it('stays connected until the last phone disconnects and resets when the host closes', async () => {
  await receive('peer-open', 'first');
  await receive('peer-open', 'second');
  links.get('first')!.mode('direct');
  await receive('relay-ready', 'second');
  await receive('peer-close', 'first');
  expect(mobileConnection.getSnapshot()).toBe(true);
  native.receive!({ type: 'disconnected', generation: 2 });
  expect(mobileConnection.getSnapshot()).toBe(false);
  links.get('second')!.mode('direct');
  expect(mobileConnection.getSnapshot()).toBe(false);
});
