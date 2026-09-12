// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';
import { ChatHost } from './host';
import { mobileConnection } from './mobileConnection';

const links = vi.hoisted(() => new Map<string, { mode: (mode: ConnectionMode) => void; close: () => void }>());
vi.mock('../pages/codexGui/api', () => ({ guiApi: { subscribe: vi.fn(async () => vi.fn()) } }));
vi.mock('../pages/codexGui/webEvents', () => ({ subscribeGuiEvent: vi.fn(async () => vi.fn()) }));
vi.mock('./operations', () => ({ ChatOperations: class {} }));
vi.mock('../../../../shared/remote-chat/link', () => ({ ChatLink: class {
  private closed = false;
  constructor(private options: { sessionId: string; mode: (mode: ConnectionMode) => void }) {
    links.set(options.sessionId, { mode: options.mode, close: () => this.close() });
  }
  enableRelay() { this.options.mode('relay'); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.options.mode('offline');
  }
} }));

let host: ChatHost;
let socket: { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>;
  onmessage?: (event: { data: string }) => void; onclose?: () => void };

beforeEach(() => {
  links.clear();
  mobileConnection.setConnected(false);
  socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  vi.stubGlobal('WebSocket', Object.assign(vi.fn(function () { return socket; }), { OPEN: 1 }));
  host = new ChatHost({ websocketUrl: 'ws://localhost', accessToken: 'test', deviceId: 'pc' },
    mobileConnection.setConnected);
});
afterEach(() => { host.close(); vi.unstubAllGlobals(); });

async function receive(type: string, sessionId: string) {
  socket.onmessage?.({ data: JSON.stringify({ type, sessionId, publicKey: 'test', iceServers: [] }) });
  await Promise.resolve();
}

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
  socket.onclose?.();
  expect(mobileConnection.getSnapshot()).toBe(false);
  links.get('second')!.mode('direct');
  expect(mobileConnection.getSnapshot()).toBe(false);
});
