import { afterEach, expect, it, vi } from 'vitest';
import { BrowserDesktopRelayHost } from './relayHost';
import type { BrowserDesktopPeer } from './directHost';
import { STANDBY_ACTIVE, STANDBY_ACTIVATE, STANDBY_PING, STANDBY_PONG }
  from '../../../../shared/remote-desktop/standbyProtocol';

function peer() {
  const track = { kind: 'video' };
  const sender = { track: track as typeof track | null,
    replaceTrack: vi.fn(async (value: typeof track | null) => { sender.track = value; }) };
  const pc = { connectionState: 'connected', close: vi.fn(), getSenders: () => [sender] };
  const channel = { readyState: 'open', send: vi.fn() };
  return { peer: { pc, channel, clipboard: channel, sender } as unknown as BrowserDesktopPeer, track, sender };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('consumes early standby controls without treating an unregistered peer as a healthy backup', () => {
  const active = peer(), activate = vi.fn(() => active.peer);
  const host = new BrowserDesktopRelayHost({ iceServers: [], stream: () => undefined,
    current: () => active.peer.pc, bind: vi.fn(), activate });
  expect(host.receive(active.peer, STANDBY_PING)).toBe('ignored');
  expect(host.receive(active.peer, STANDBY_ACTIVATE)).toBe('ignored');
  expect(host.receive(active.peer, '{"kind":"move"}')).toBe(false);
  expect(active.peer.channel.send).not.toHaveBeenCalled();
  expect(activate).not.toHaveBeenCalled();
  expect(active.peer.pc.close).not.toHaveBeenCalled();
  host.close();
});

it('pauses only the backup sender, keeps its control channel and restores it on fallback', async () => {
  vi.useFakeTimers();
  const active = peer(), backup = peer(); let current = active.peer;
  const activate = vi.fn((value: BrowserDesktopPeer) => { const old = current; current = value; return old; });
  const host = new BrowserDesktopRelayHost({ iceServers: [], stream: () => undefined,
    current: () => current.pc, bind: vi.fn(), activate });
  host.retain(backup.peer); await vi.advanceTimersByTimeAsync(0);
  expect(backup.sender.replaceTrack).toHaveBeenCalledExactlyOnceWith(null);
  expect(active.sender.replaceTrack).not.toHaveBeenCalled();
  expect(backup.peer.pc.close).not.toHaveBeenCalled();
  expect(host.receive(backup.peer, STANDBY_PING)).toBe(true);
  expect(backup.peer.channel.send).toHaveBeenLastCalledWith(STANDBY_PONG);
  expect(host.receive(active.peer, STANDBY_PING)).toBe('ignored');
  expect(active.peer.channel.send).not.toHaveBeenCalled();
  await Promise.all([host.fallback(active.peer.pc), host.fallback(active.peer.pc)]);
  expect(backup.sender.replaceTrack).toHaveBeenLastCalledWith(backup.track);
  expect(activate).toHaveBeenCalledExactlyOnceWith(backup.peer);
  expect(active.peer.pc.close).toHaveBeenCalledOnce();
  expect(backup.peer.channel.send).toHaveBeenLastCalledWith(STANDBY_ACTIVE);
  expect(await host.fallback(backup.peer.pc)).toBe(false);
  host.close(); expect(backup.peer.pc.close).toHaveBeenCalledOnce();
});

it('releases a replaced backup and never activates a closed session', async () => {
  const active = peer(), first = peer(), second = peer();
  const activate = vi.fn(() => active.peer);
  const host = new BrowserDesktopRelayHost({ iceServers: [], stream: () => undefined,
    current: () => active.peer.pc, bind: vi.fn(), activate });
  host.retain(first.peer); host.retain(second.peer);
  expect(first.peer.pc.close).toHaveBeenCalledOnce();
  host.close(); expect(await host.fallback()).toBe(false);
  expect(activate).not.toHaveBeenCalled();
});

it('cancels a pending backup offer when a previous relay is retained during promotion', async () => {
  vi.useFakeTimers();
  const active = peer(), retained = peer(), pending = peer();
  let resolveOffer!: (offer: RTCSessionDescriptionInit) => void;
  const pc = Object.assign(pending.peer.pc, {
    createDataChannel: () => pending.peer.channel, addTrack: () => pending.sender,
    addEventListener: vi.fn(), setLocalDescription: vi.fn(),
    createOffer: () => new Promise<RTCSessionDescriptionInit>(resolve => { resolveOffer = resolve; }),
  });
  vi.stubGlobal('RTCPeerConnection', vi.fn(function () { return pc; }));
  const host = new BrowserDesktopRelayHost({ iceServers: [{ urls: 'turn:relay.test' }],
    stream: () => ({ getTracks: () => [pending.track] }) as unknown as MediaStream,
    current: () => active.peer.pc, bind: vi.fn(), activate: vi.fn(() => active.peer) });
  const offer = host.signal({ candidates: [], relayStandby: { generation: 1, action: 'start' } });
  host.retain(retained.peer);
  resolveOffer({ type: 'offer', sdp: 'offer' });
  await expect(offer).rejects.toThrow();
  expect(pc.close).toHaveBeenCalledOnce();
  expect(pc.setLocalDescription).not.toHaveBeenCalled();
  expect(await host.signal({ candidates: [], relayStandby: { generation: 1, action: 'commit' } }))
    .toMatchObject({ committed: false });
  expect(await host.fallback(active.peer.pc)).toBe(true);
  expect(retained.sender.replaceTrack).toHaveBeenLastCalledWith(retained.track);
  expect(retained.peer.pc.close).not.toHaveBeenCalled();
  host.close(); expect(vi.getTimerCount()).toBe(0);
});
