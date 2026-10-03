import { afterEach, expect, it, vi } from 'vitest';
import { DesktopRelayStandby } from '../../../../shared/remote-desktop/relayStandby';
import { relayIceServers, STANDBY_ACTIVE, STANDBY_ACTIVATE, STANDBY_PING, STANDBY_PONG }
  from '../../../../shared/remote-desktop/standbyProtocol';

function peer() {
  const channel = Object.assign(new EventTarget(), { readyState: 'open', send: vi.fn() });
  const audio = { enabled: true };
  const pc = { connectionState: 'connected', close: vi.fn() };
  return { pc: pc as unknown as RTCPeerConnection, channel: channel as unknown as RTCDataChannel,
    stream: { getAudioTracks: () => [audio] } as unknown as MediaStream, audio,
    message: (data: string) => channel.dispatchEvent(Object.assign(new Event('message'), { data })) };
}
function fixture() {
  vi.useFakeTimers();
  const options = { iceServers: [], createPeer: vi.fn(), signal: vi.fn(), activate: vi.fn(), failed: vi.fn() };
  return { ...options, standby: new DesktopRelayStandby(options) };
}
afterEach(() => vi.useRealTimers());

it('keeps the retained relay alive and activates it without waiting for signaling', async () => {
  const f = fixture(), backup = peer();
  f.standby.retain(backup); f.standby.update(true);
  expect(backup.audio.enabled).toBe(false);
  expect(backup.channel.send).toHaveBeenCalledWith(STANDBY_PING);
  for (let tick = 0; tick < 10; tick++) {
    backup.message(STANDBY_PONG); await vi.advanceTimersByTimeAsync(2000);
  }
  expect(backup.pc.close).not.toHaveBeenCalled();
  expect(f.standby.fallback()).toBe(true);
  expect(backup.channel.send).toHaveBeenLastCalledWith(STANDBY_ACTIVATE);
  await vi.advanceTimersByTimeAsync(2000);
  expect(backup.channel.send).toHaveBeenLastCalledWith(STANDBY_ACTIVATE);
  backup.message(STANDBY_ACTIVE); backup.message(STANDBY_ACTIVE);
  expect(f.activate).toHaveBeenCalledExactlyOnceWith(backup);
  expect(f.signal).not.toHaveBeenCalled();
  f.standby.close(); expect(vi.getTimerCount()).toBe(0);
});

it('rejects a dead backup and releases it without interrupting a working direct path', async () => {
  const f = fixture(), backup = peer(); f.standby.retain(backup);
  await vi.advanceTimersByTimeAsync(6000);
  expect(backup.pc.close).toHaveBeenCalledOnce();
  expect(f.standby.fallback()).toBe(false); expect(f.failed).not.toHaveBeenCalled();
  f.standby.close();
});

it('reports an unsuccessful fallback once and ignores late activation after close', async () => {
  const f = fixture(), backup = peer(); f.standby.retain(backup); f.standby.fallback();
  await vi.advanceTimersByTimeAsync(8000);
  expect(f.failed).toHaveBeenCalledOnce(); f.standby.close(); backup.message(STANDBY_ACTIVE);
  expect(f.activate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('excludes STUN and native direct adapters from an independent TURN backup', () => {
  expect(relayIceServers([{ urls: ['stun:test', 'turns:relay'], username: 'u', credential: 'p' },
    { urls: 'turn:127.0.0.1', nativeMedia: true }])).toEqual([
    { urls: ['turns:relay'], username: 'u', credential: 'p' },
  ]);
});
