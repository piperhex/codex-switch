import { afterEach, expect, it, vi } from 'vitest';
import { DesktopReceiver } from '../../../../shared/remote-desktop/receiver';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

afterEach(() => vi.useRealTimers());
it('merges audio arriving first, preserves mute on late tracks and releases sound on close', async () => {
  vi.useFakeTimers();
  const events = new Map<string, (event: unknown) => void>();
  const peer = { addEventListener: vi.fn((name, callback) => events.set(name, callback)),
    setRemoteDescription: vi.fn(), createAnswer: vi.fn(async () => ({ sdp: 'answer' })),
    setLocalDescription: vi.fn(), close: vi.fn(), connectionState: 'new', iceGatheringState: 'complete' };
  const options = { client: { open: vi.fn(async () => ({ sdp: 'offer', iceServers: [] })),
    signal: vi.fn(async () => ({ candidates: [] })), settings: vi.fn(), close: vi.fn() },
    createPeer: () => peer as unknown as RTCPeerConnection, stream: vi.fn(), stats: vi.fn(), status: vi.fn(),
    audio: vi.fn() };
  const receiver = new DesktopReceiver(options);
  receiver.mute(true);
  await receiver.start(DEFAULT_SETTINGS);
  const audio = { id: 'audio', kind: 'audio', enabled: true, stop: vi.fn() };
  const video = { id: 'video', kind: 'video', enabled: true, stop: vi.fn() };
  const tracks = [audio];
  const stream = { getTracks: () => tracks, addTrack: (track: typeof audio) => tracks.push(track) };
  events.get('track')!({ track: audio, streams: [stream] });
  expect(audio.enabled).toBe(false);
  expect(options.audio).toHaveBeenLastCalledWith(true);
  events.get('track')!({ track: video, streams: [{ getTracks: () => [video] }] });
  expect(options.stream).toHaveBeenLastCalledWith(stream);
  expect(tracks).toEqual([audio, video]);
  receiver.mute(false); expect(audio.enabled).toBe(true);
  await receiver.stop(); expect(audio.enabled).toBe(false); expect(audio.stop).toHaveBeenCalledOnce();
  expect(video.stop).not.toHaveBeenCalled();
  expect(options.audio).toHaveBeenLastCalledWith(false);
  expect(peer.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
