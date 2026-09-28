import { afterEach, expect, it, vi } from 'vitest';
import { MobileChatConnection } from './connection';
import type { AuthSession } from '../types';

const platform = vi.hoisted(() => ({ OS: 'ios', constants: { Model: 'Test phone' } }));
vi.mock('react-native', () => ({ Platform: platform, NativeModules: {} }));
vi.mock('react-native-webrtc', () => ({ RTCPeerConnection: class {} }));
vi.mock('react-native-tcp-socket', () => ({ default: {} }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length).fill(7) }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => {}) }));
vi.mock('../api/client', () => ({ fetchUserProfile: vi.fn(async () => ({})) }));

class Socket {
  static latest: Socket | undefined;
  onopen?: () => void;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.latest = this; }
}
afterEach(() => { Socket.latest = undefined; vi.unstubAllGlobals(); });

it.each(['android', 'ios'])('advertises native TCP support in the authenticated %s wire handshake', async os => {
  platform.OS = os;
  vi.stubGlobal('WebSocket', Socket);
  const session = { baseUrl: 'https://example.test', accessToken: 'test-only-token' } as AuthSession;
  const connection = new MobileChatConnection({ session, deviceId: 'target-pc',
    mode: vi.fn(), ready: vi.fn(), event: vi.fn(), error: vi.fn() });
  try {
    connection.start();
    await vi.waitFor(() => expect(Socket.latest?.onopen).toBeTypeOf('function'));
    const socket = Socket.latest!;
    socket.onopen?.();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      deviceId: 'target-pc', tcpPunch: true, transportVersion: 2,
      clientInfo: { platform: os === 'ios' ? 'iOS' : 'Android' },
    });
  } finally { connection.stop(); }
});
