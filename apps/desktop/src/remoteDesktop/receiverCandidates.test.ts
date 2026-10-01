import { afterEach, expect, it, vi } from 'vitest';
import { DesktopReceiver } from '../../../../shared/remote-desktop/receiver';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

afterEach(() => vi.useRealTimers());

it('keeps signaling and tries a public candidate after an unsupported mDNS candidate', async () => {
  vi.useFakeTimers();
  const candidates = ['hidden.local', '203.0.113.4'].map(host => ({
    candidate: `candidate:1 1 udp 1 ${host} 40000 typ host`, sdpMid: '0', sdpMLineIndex: 0,
  }));
  const diagnostic = vi.fn(), failed = vi.fn();
  const pc = { addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn(),
    setRemoteDescription: vi.fn(), createAnswer: vi.fn(async () => ({ sdp: 'answer' })),
    setLocalDescription: vi.fn(), connectionState: 'connecting', iceGatheringState: 'complete',
    addIceCandidate: vi.fn().mockRejectedValueOnce(new DOMException('private address', 'OperationError'))
      .mockResolvedValue(undefined) };
  const signal = vi.fn().mockResolvedValueOnce({ candidates }).mockResolvedValue({ candidates: [] });
  const receiver = new DesktopReceiver({ client: {
    open: vi.fn(async () => ({ sdp: 'offer', iceServers: [] })), signal, close: vi.fn(), settings: vi.fn(), diagnostic,
  }, createPeer: () => pc as unknown as RTCPeerConnection, stream: vi.fn(), stats: vi.fn(), status: vi.fn(), failed });
  await receiver.start(DEFAULT_SETTINGS);
  expect(pc.addIceCandidate.mock.calls.map(([candidate]) => candidate)).toEqual(candidates);
  expect(failed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(400);
  expect(signal).toHaveBeenCalledTimes(2);
  expect(diagnostic).toHaveBeenCalledWith('candidate-rejected', expect.objectContaining({
    scope: 'desktop', addressKind: 'mdns', reason: 'operation-failed',
  }));
  expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/hidden\.local|203\.0\.113|private address/);
  await receiver.stop();
  expect(vi.getTimerCount()).toBe(0);
});
