import { afterEach, expect, it, vi } from 'vitest';
import { DesktopRelayStandby } from '../../../../shared/remote-desktop/relayStandby';
import type { DesktopSignal, DesktopSignalReply } from '../../../../shared/remote-desktop/protocol';
import { STANDBY_ACTIVE, STANDBY_PONG } from '../../../../shared/remote-desktop/standbyProtocol';

class Peer extends EventTarget {
  connectionState = 'connecting';
  channel = Object.assign(new EventTarget(), { label: 'remote-desktop-controls', readyState: 'open', send: vi.fn() });
  stream = { getTracks: () => [], getAudioTracks: () => [], addTrack: vi.fn() };
  close = vi.fn(() => { this.connectionState = 'closed'; });
  setRemoteDescription = vi.fn(async () => {
    this.dispatchEvent(Object.assign(new Event('track'), { track: { kind: 'video' }, streams: [this.stream] }));
    this.dispatchEvent(Object.assign(new Event('datachannel'), { channel: this.channel }));
    this.connectionState = 'connected';
  });
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer' }));
  setLocalDescription = vi.fn();
  addIceCandidate = vi.fn();
}
function fixture() {
  vi.useFakeTimers();
  const peers: Peer[] = [];
  const options = { iceServers: [{ urls: 'turn:test', username: 'u', credential: 'p' }],
    createPeer: vi.fn(() => { const peer = new Peer(); peers.push(peer); return peer as unknown as RTCPeerConnection; }),
    signal: vi.fn(async (signal: DesktopSignal): Promise<DesktopSignalReply> => ({ candidates: [],
      generation: signal.relayStandby?.generation, sdp: 'offer', committed: true })),
    activate: vi.fn(), failed: vi.fn() };
  return { ...options, peers, standby: new DesktopRelayStandby(options) };
}
afterEach(() => vi.useRealTimers());

it('creates a relay-only backup for an initial P2P session and rebuilds only the failed backup', async () => {
  const f = fixture(); f.standby.update(true); await vi.advanceTimersByTimeAsync(0);
  expect(f.createPeer).toHaveBeenCalledWith({ iceServers: [{ urls: ['turn:test'], username: 'u', credential: 'p' }],
    iceTransportPolicy: 'relay' });
  expect(f.signal.mock.calls.map(([signal]) => signal.relayStandby?.action)).toEqual(['start', 'signal', 'commit']);
  expect(f.activate).not.toHaveBeenCalled();
  f.peers[0].close(); await vi.advanceTimersByTimeAsync(6000);
  expect(f.peers).toHaveLength(2); expect(f.failed).not.toHaveBeenCalled();
  const backup = f.peers[1];
  backup.channel.dispatchEvent(Object.assign(new Event('message'), { data: STANDBY_PONG }));
  expect(f.standby.fallback()).toBe(true);
  backup.channel.dispatchEvent(Object.assign(new Event('message'), { data: STANDBY_ACTIVE }));
  expect(f.activate).toHaveBeenCalledOnce();
  f.standby.close(); expect(vi.getTimerCount()).toBe(0);
});

it('does not overlap negotiation or revive a stopped viewer after a late offer', async () => {
  const f = fixture(); let resolve!: (value: DesktopSignalReply) => void;
  f.signal.mockImplementation(signal => signal.relayStandby?.action === 'start'
    ? new Promise(done => { resolve = done; }) : Promise.resolve({ candidates: [] }));
  f.standby.update(true); await vi.advanceTimersByTimeAsync(60_000);
  expect(f.peers).toHaveLength(1); f.standby.close();
  resolve({ sdp: 'offer', candidates: [], generation: 1 }); await vi.advanceTimersByTimeAsync(0);
  expect(f.peers[0].setRemoteDescription).not.toHaveBeenCalled();
  expect(f.activate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
