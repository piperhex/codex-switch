import { afterEach, expect, it, vi } from 'vitest';
import { DesktopDirectUpgrade, directIceServers } from '../../../../shared/remote-desktop/directUpgrade';
import type { DesktopSignal, DesktopSignalReply } from '../../../../shared/remote-desktop/protocol';

class Peer extends EventTarget {
  connectionState = 'connecting';
  localDescription?: RTCSessionDescriptionInit;
  decoded = 0;
  relay = false;
  close = vi.fn(() => { this.connectionState = 'closed'; });
  setRemoteDescription = vi.fn(async () => {});
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer' }));
  setLocalDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => { this.localDescription = sdp; });
  addIceCandidate = vi.fn(async () => {});
  getStats = vi.fn(async () => new Map([
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { id: 'local', type: 'local-candidate', candidateType: this.relay ? 'relay' : 'host' }],
    ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'srflx' }],
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

function fixture() {
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
  const upgrade = new DesktopDirectUpgrade({ createPeer, signal, activate,
    iceServers: [{ urls: ['stun:stun.test', 'turn:relay.test'], username: 'private', credential: 'secret' }] });
  return { peers, createPeer, signal, activate, upgrade };
}
afterEach(() => vi.useRealTimers());

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
