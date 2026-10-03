import { afterEach, expect, it, vi } from 'vitest';
import { closeNativeMedia, isNativeMediaPair, openNativeMedia, type NativeMediaSession }
  from '../../../../shared/remote-desktop/nativeMedia';
import { monitorDesktopStats } from '../../../../shared/remote-desktop/statsMonitor';
import { NativeMediaHostSession } from './nativeMediaSession';
import type { DesktopHostSession } from './host';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';
import type { IceServer } from '../../../../shared/remote-chat/protocol';

const publicServers = [{ urls: ['turn:public.test'], username: 'user', credential: 'public-credential' }];
function media(): NativeMediaSession {
  return { endpoint: { urls: ['turn:127.0.0.1:12345?transport=udp'], username: 'desktop-media',
    credential: 'local-only', localAddress: '10.253.0.2', remoteAddress: '10.253.0.1' },
    status: vi.fn(async () => ({ direct: true, protocol: 'tcp', ipv6: false, rttMs: 35 })), close: vi.fn(async () => {}) };
}
function fixture(native: Promise<NativeMediaSession> = Promise.resolve(media())) {
  const session: DesktopHostSession = { closed: false, open: vi.fn(async () => ({ sdp: 'offer',
    width: 1280, height: 720, iceServers: [{ urls: 'local-only' }] })),
    signal: vi.fn(), update: vi.fn(), close: vi.fn() };
  const create = vi.fn((_ice: IceServer[]) => session);
  const factory = vi.fn(() => native);
  const wrapper = new NativeMediaHostSession({ id: 'desktop-test', settings: { ...DEFAULT_SETTINGS, nativeMedia: true },
    iceServers: publicServers, media: factory, create });
  return { session, create, factory, wrapper };
}
afterEach(() => vi.useRealTimers());

it('keeps local adapter credentials on the host and releases it with capture', async () => {
  const native = media(); const f = fixture(Promise.resolve(native));
  const offer = await f.wrapper.open();
  expect(f.create.mock.calls[0][0]).toEqual([{ ...native.endpoint, nativeMedia: true }, ...publicServers]);
  expect(offer.iceServers).toEqual(publicServers); expect(offer.nativeMedia).toBe(true);
  expect(JSON.stringify(offer)).not.toContain('local-only');
  await f.wrapper.close(); expect(native.close).toHaveBeenCalledOnce(); expect(f.session.close).toHaveBeenCalledOnce();
});

it('falls back to ordinary ICE for an older native module and closes capture if opening fails', async () => {
  const f = fixture(Promise.reject(new Error('Unsupported operation')));
  expect((await f.wrapper.open()).nativeMedia).toBe(false);
  expect(f.create).toHaveBeenCalledWith(publicServers);
  await f.wrapper.close();
  const native = media(); const failed = fixture(Promise.resolve(native));
  vi.mocked(failed.session.open).mockRejectedValue(new Error('Capture refused'));
  await expect(failed.wrapper.open()).rejects.toThrow('Capture refused');
  expect(native.close).toHaveBeenCalledOnce(); expect(failed.session.close).toHaveBeenCalledOnce();
});

it('releases a late native adapter after the viewer closes without starting capture', async () => {
  let resolve!: (session: NativeMediaSession) => void;
  const f = fixture(new Promise(done => { resolve = done; }));
  const opening = f.wrapper.open(); const rejected = expect(opening).rejects.toThrow('已结束');
  await f.wrapper.close(); const native = media(); resolve(native); await rejected;
  expect(native.close).toHaveBeenCalledOnce(); expect(f.create).not.toHaveBeenCalled();
});

it('bounds native opening and cleanup and releases results arriving after fallback', async () => {
  vi.useFakeTimers(); let resolve!: (session: NativeMediaSession) => void;
  const opening = openNativeMedia(() => new Promise(done => { resolve = done; }), 'desktop-test');
  await vi.advanceTimersByTimeAsync(4000); expect(await opening).toBeUndefined();
  const native = media(); resolve(native); await vi.advanceTimersByTimeAsync(0);
  expect(native.close).toHaveBeenCalledOnce();
  const closing = closeNativeMedia({ ...native, close: () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(2000); await closing; expect(vi.getTimerCount()).toBe(0);
});

const pair = (address = '10.253.0.1') => ({
  local: { candidateType: 'relay', address: '10.253.0.2', protocol: 'udp' },
  remote: { candidateType: 'relay', address },
});
it('never classifies a public relay or a mismatched virtual pair as native direct', () => {
  expect(isNativeMediaPair(pair(), media().endpoint)).toBe(true);
  expect(isNativeMediaPair(pair('192.0.2.1'), media().endpoint)).toBe(false);
  expect(isNativeMediaPair(pair())).toBe(false);
});

it('reports the actual native transport and clears P2P when its direct route is lost', async () => {
  vi.useFakeTimers(); const native = media(); const candidates = pair();
  const getStats = vi.fn(async () => new Map([
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { id: 'local', type: 'local-candidate', ...candidates.local }],
    ['remote', { id: 'remote', type: 'remote-candidate', ...candidates.remote }],
  ]));
  const publish = vi.fn(); const stop = monitorDesktopStats({ getStats } as unknown as RTCPeerConnection, publish, native);
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ connection: 'direct', transport: 'TCP', rttMs: 35 }));
  // Rust Option fields are serialized as null while the route is unavailable.
  vi.mocked(native.status).mockResolvedValue({ direct: false, ipv6: false, protocol: null, rttMs: null });
  await vi.advanceTimersByTimeAsync(1000);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
    connection: undefined, transport: undefined, rttMs: undefined,
  }));
  vi.mocked(native.status).mockResolvedValue({ direct: true, protocol: 'udp', ipv6: false, rttMs: 0 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
    connection: 'direct', transport: 'UDP', rttMs: 0,
  }));
  stop(); expect(vi.getTimerCount()).toBe(0);
});
