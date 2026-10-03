import { afterEach, expect, it, vi } from 'vitest';
import { DesktopDirectUpgrade, directIceServers } from '../../../../shared/remote-desktop/directUpgrade';
import type { DesktopSignal, DesktopSignalReply } from '../../../../shared/remote-desktop/protocol';
import type { NativeMediaSession } from '../../../../shared/remote-desktop/nativeMedia';
import { DesktopDirectRetry } from '../../../../shared/remote-desktop/directRetry';

class Peer extends EventTarget {
  connectionState = 'connecting';
  localDescription?: RTCSessionDescriptionInit;
  decoded = 0;
  relay = false;
  native = false;
  close = vi.fn(() => { this.connectionState = 'closed'; });
  setRemoteDescription = vi.fn(async () => {});
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer' }));
  setLocalDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => { this.localDescription = sdp; });
  addIceCandidate = vi.fn(async () => {});
  getStats = vi.fn(async () => new Map([
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { id: 'local', type: 'local-candidate', candidateType: this.relay ? 'relay' : 'host',
      address: this.native ? '10.253.0.2' : '192.0.2.1' }],
    ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'srflx',
      address: this.native ? '10.253.0.1' : '192.0.2.2' }],
    ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', framesDecoded: this.decoded }],
  ]));
  emit(name: string, fields: object) { this.dispatchEvent(Object.assign(new Event(name), fields)); }
  ready() {
    this.connectionState = 'connected';
    const track = { id: 'video', kind: 'video' };
    const stream = { getTracks: () => [track] };
    this.emit('track', { track, streams: [stream] });
    this.emit('datachannel', { channel: { readyState: 'open', label: 'remote-desktop-controls' } });
  }
}

function fixture(nativeMedia?: NativeMediaSession, retry?: DesktopDirectRetry) {
  vi.useFakeTimers();
  const peers: Peer[] = [];
  const createPeer = vi.fn(() => {
    const peer = new Peer(); peers.push(peer); return peer as unknown as RTCPeerConnection;
  });
  const signal = vi.fn(async (request: DesktopSignal): Promise<DesktopSignalReply> => ({
    candidates: [], generation: request.directUpgrade?.generation,
    ...(request.directUpgrade?.action === 'start' ? { sdp: 'offer' } : {}),
    ...(request.directUpgrade?.action === 'commit' ? { committed: true } : {}),
  }));
  const activate = vi.fn();
  const upgrade = new DesktopDirectUpgrade({ createPeer, signal, activate, nativeMedia, retry,
    iceServers: [{ urls: ['stun:stun.test', 'turn:relay.test'], username: 'private', credential: 'secret' },
      ...(nativeMedia ? [{ ...nativeMedia.endpoint, nativeMedia: true }] : [])] });
  return { peers, createPeer, signal, activate, upgrade };
}
afterEach(() => vi.useRealTimers());

it('keeps increasing cooldown when promoted peers repeatedly fall back to the working relay', async () => {
  const f = fixture(); f.upgrade.update({ connection: 'relay' });
  await vi.advanceTimersByTimeAsync(5000);
  for (const [index, cooldown] of [15_000, 30_000, 60_000].entries()) {
    f.peers[index].ready(); f.peers[index].decoded = 1;
    await vi.advanceTimersByTimeAsync(400);
    expect(f.activate).toHaveBeenCalledTimes(index + 1);
    f.upgrade.update({ connection: 'relay' });
    await vi.advanceTimersByTimeAsync(cooldown - 1);
    expect(f.peers).toHaveLength(index + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.peers).toHaveLength(index + 2);
  }
  f.upgrade.close(); expect(vi.getTimerCount()).toBe(0);
});

it('preserves the cooldown when a desktop failure recreates the direct-upgrade controller', async () => {
  const retry = new DesktopDirectRetry(), first = fixture(undefined, retry);
  first.upgrade.update({ connection: 'relay' }); await vi.advanceTimersByTimeAsync(5000);
  first.peers[0].ready(); first.peers[0].decoded = 1;
  await vi.advanceTimersByTimeAsync(400); expect(first.activate).toHaveBeenCalledOnce();
  retry.update('relay'); first.upgrade.close();
  const second = fixture(undefined, retry); second.upgrade.update({ connection: 'relay' });
  first.upgrade.update({ connection: 'direct' }); second.upgrade.update({ connection: 'relay' });
  expect(retry.delay).toBe(15_000);
  await vi.advanceTimersByTimeAsync(14_999); expect(second.peers).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1); expect(second.peers).toHaveLength(1);
  second.upgrade.close(); expect(vi.getTimerCount()).toBe(0);
});

it('keeps retrying a failed direct probe with bounded backoff and no TURN allocation', async () => {
  const f = fixture(); f.upgrade.update({ connection: 'relay' });
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.createPeer).toHaveBeenCalledWith({ iceServers: [{ urls: ['stun:stun.test'] }] });
  await vi.advanceTimersByTimeAsync(26_000);
  expect(f.peers[0].close).toHaveBeenCalledOnce();
  expect(f.activate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(f.peers).toHaveLength(2);
  expect(f.signal.mock.calls.some(([s]) => s.directUpgrade?.action === 'cancel')).toBe(true);
  f.upgrade.close(); expect(vi.getTimerCount()).toBe(0);
});

it('waits for decoded direct video and an open control channel before requesting promotion', async () => {
  const f = fixture(); f.upgrade.update({ connection: 'relay' });
  await vi.advanceTimersByTimeAsync(5000); f.peers[0].ready();
  await vi.advanceTimersByTimeAsync(400); expect(f.activate).not.toHaveBeenCalled();
  f.peers[0].decoded = 1; f.peers[0].relay = true;
  await vi.advanceTimersByTimeAsync(400); expect(f.activate).not.toHaveBeenCalled();
  f.peers[0].relay = false;
  await vi.advanceTimersByTimeAsync(400);
  expect(f.activate).toHaveBeenCalledOnce();
  expect(f.peers[0].close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(120_000); expect(f.peers).toHaveLength(1);
  f.upgrade.close();
});

it('retries a lost promotion acknowledgement without cancelling either working peer', async () => {
  const f = fixture(); const signal = f.signal.getMockImplementation()!;
  let lost = false;
  f.signal.mockImplementation(async request => {
    if (request.directUpgrade?.action === 'commit' && !lost) { lost = true; throw new Error('reply lost'); }
    return signal(request);
  });
  f.upgrade.update({ connection: 'relay' }); await vi.advanceTimersByTimeAsync(5000);
  f.peers[0].ready(); f.peers[0].decoded = 1;
  await vi.advanceTimersByTimeAsync(400);
  expect(f.activate).not.toHaveBeenCalled(); expect(f.peers[0].close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000); expect(f.activate).toHaveBeenCalledOnce();
  expect(f.signal.mock.calls.filter(([s]) => s.directUpgrade?.action === 'commit')).toHaveLength(2);
  f.upgrade.close();
});

it('does not overlap a slow start or resurrect a peer after the desktop is closed', async () => {
  const f = fixture(); let resolve!: (reply: DesktopSignalReply) => void;
  f.signal.mockImplementation(() => new Promise(done => { resolve = done; }));
  f.upgrade.update({ connection: 'relay' }); await vi.advanceTimersByTimeAsync(5000);
  for (let i = 0; i < 5; i++) f.upgrade.update({ connection: 'relay' });
  await vi.advanceTimersByTimeAsync(60_000); expect(f.peers).toHaveLength(1);
  f.upgrade.close(); resolve({ candidates: [], sdp: 'late', generation: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.peers[0].setRemoteDescription).not.toHaveBeenCalled();
  expect(f.activate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('skips retries when the original connection becomes direct before the retry timer fires', async () => {
  const f = fixture(); f.upgrade.update({ connection: 'relay' }); f.upgrade.update({ connection: 'direct' });
  await vi.advanceTimersByTimeAsync(60_000); expect(f.peers).toHaveLength(0); f.upgrade.close();
  expect(directIceServers([{ urls: ['turns:relay.test', 'stun:stun.test'] }]))
    .toEqual([{ urls: ['stun:stun.test'] }]);
});

it('replaces an older five-second retry when the original path briefly becomes direct and falls back', async () => {
  const f = fixture(); f.upgrade.update({ connection: 'relay' });
  await vi.advanceTimersByTimeAsync(1000); f.upgrade.update({ connection: 'direct' });
  await vi.advanceTimersByTimeAsync(100); f.upgrade.update({ connection: 'relay' });
  await vi.advanceTimersByTimeAsync(14_999); expect(f.peers).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1); expect(f.peers).toHaveLength(1);
  f.upgrade.close(); expect(vi.getTimerCount()).toBe(0);
});

it('waits for cancellation to finish before starting another probe', async () => {
  const f = fixture(); const signal = f.signal.getMockImplementation()!;
  let cancel!: () => void;
  f.signal.mockImplementation(request => request.directUpgrade?.action === 'cancel'
    ? new Promise(resolve => { cancel = () => resolve({ candidates: [] }); }) : signal(request));
  f.upgrade.update({ connection: 'relay' }); await vi.advanceTimersByTimeAsync(31_000);
  f.upgrade.update({ connection: 'relay' }); await vi.advanceTimersByTimeAsync(60_000);
  expect(f.peers).toHaveLength(1);
  cancel(); await vi.advanceTimersByTimeAsync(15_000);
  expect(f.peers).toHaveLength(2); f.upgrade.close();
});

it('promotes a local native adapter only after the underlying chat route is direct', async () => {
  const status = vi.fn(async () => ({ direct: false, ipv6: false }));
  const endpoint = { urls: ['turn:127.0.0.1:12345?transport=udp'], username: 'desktop-media', credential: 'secret',
    localAddress: '10.253.0.2', remoteAddress: '10.253.0.1' };
  const f = fixture({ endpoint, status, close: vi.fn() });
  f.upgrade.update({ connection: 'relay' }); await vi.advanceTimersByTimeAsync(5000);
  expect(f.createPeer).toHaveBeenCalledWith({ iceServers: [
    { urls: ['stun:stun.test'] }, { ...endpoint, nativeMedia: true },
  ] });
  const peer = f.peers[0]; peer.ready(); peer.decoded = 10; peer.relay = true; peer.native = true;
  await vi.advanceTimersByTimeAsync(400); expect(f.activate).not.toHaveBeenCalled();
  status.mockResolvedValue({ direct: true, ipv6: false });
  await vi.advanceTimersByTimeAsync(400); expect(f.activate).toHaveBeenCalledOnce();
  f.upgrade.close();
});
