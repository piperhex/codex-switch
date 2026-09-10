import { describe, expect, it, vi } from 'vitest';
import { RtcPeer } from '../../../../shared/remote-chat/rtcPeer';
import type { Signal } from '../../../../shared/remote-chat/protocol';

const offer: Signal = { kind: 'sdp', type: 'offer', sdp: 'test-offer' };
const answer = { type: 'answer', sdp: 'test-answer' };
const candidate = (address: string): Exclude<Signal, { kind: 'key' }> => ({
  kind: 'ice', candidate: `candidate:1 1 udp 2122260223 ${address} 50000 typ host`,
  sdpMid: '0', sdpMLineIndex: 0,
});

function harness() {
  const signal = vi.fn();
  const pc = {
    remoteDescription: null as RTCSessionDescriptionInit | null,
    addEventListener: vi.fn(), close: vi.fn(),
    setRemoteDescription: vi.fn(async (description: RTCSessionDescriptionInit) => {
      pc.remoteDescription = description;
    }),
    addIceCandidate: vi.fn(async (_candidate: RTCIceCandidateInit) => undefined),
    createAnswer: vi.fn(async () => answer),
    setLocalDescription: vi.fn(async () => undefined),
  };
  const peer = new RtcPeer({ iceServers: [], signal, channel: vi.fn(), disconnected: vi.fn() },
    () => pc as unknown as RTCPeerConnection);
  return { peer, pc, signal };
}

describe('RTC candidate negotiation', () => {
  it('answers an offer and tries other queued addresses when one early candidate is rejected', async () => {
    const { peer, pc, signal } = harness();
    const unsupported = candidate('unresolvable.local');
    const lan = candidate('192.168.1.10');
    await peer.accept(unsupported);
    await peer.accept(lan);
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    pc.addIceCandidate.mockRejectedValueOnce(new Error('Candidate rejected'));

    await peer.accept(offer);

    expect(pc.addIceCandidate.mock.calls.map(([value]) => value)).toEqual([unsupported, lan]);
    expect(signal).toHaveBeenCalledWith({ kind: 'sdp', ...answer });
    peer.close();
  });

  it('continues with later trickled addresses after a rejected candidate', async () => {
    const { peer, pc } = harness();
    await peer.accept(offer);
    pc.addIceCandidate.mockRejectedValueOnce(new Error('Candidate rejected'));
    await expect(peer.accept(candidate('unresolvable.local'))).resolves.toBeUndefined();
    const lan = candidate('192.168.1.10');
    await peer.accept(lan);
    expect(pc.addIceCandidate).toHaveBeenLastCalledWith(lan);
    peer.close();
  });

  it('still reports invalid session descriptions', async () => {
    const { peer, pc, signal } = harness();
    pc.setRemoteDescription.mockRejectedValueOnce(new Error('Invalid SDP'));
    await expect(peer.accept(offer)).rejects.toThrow('Invalid SDP');
    expect(signal).not.toHaveBeenCalled();
    peer.close();
  });

  it('stops draining candidates and does not answer after the peer closes', async () => {
    const { peer, pc, signal } = harness();
    await peer.accept(candidate('unresolvable.local'));
    await peer.accept(candidate('192.168.1.10'));
    pc.addIceCandidate.mockImplementationOnce(async () => { peer.close(); });
    await peer.accept(offer);
    expect(pc.addIceCandidate).toHaveBeenCalledOnce();
    expect(signal).not.toHaveBeenCalled();
  });
});
