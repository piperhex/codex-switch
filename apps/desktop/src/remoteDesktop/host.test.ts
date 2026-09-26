import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteDesktopHost } from './host';
import { HostSession as DesktopHostSession } from './hostSession';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

vi.mock('./hostSession', () => ({ HostSession: vi.fn(class {
  closed = false;
  open = vi.fn(async () => ({ sdp: 'offer', iceServers: [] }));
  signal = vi.fn(async () => ({ candidates: [] }));
  update = vi.fn();
  close = vi.fn(() => { this.closed = true; });
}) }));
beforeEach(() => vi.clearAllMocks());
const opening = { action: 'open', id: 'desktop-1', settings: DEFAULT_SETTINGS };

it('requires a registered chat session and derives ICE servers from its authenticated configuration', async () => {
  const host = new RemoteDesktopHost();
  await expect(host.request(opening, 'unknown')).rejects.toThrow('连接电脑');
  host.register('alice', [{ urls: 'stun:example.test' }]);
  await host.request({ ...opening, owner: 'forged', iceServers: [{ urls: 'stun:forged.test' }] }, 'alice');
  expect(DesktopHostSession).toHaveBeenCalledWith(DEFAULT_SETTINGS, [{ urls: 'stun:example.test' }]);
});
it('isolates controls between sessions and releases media when its owner disconnects', async () => {
  const host = new RemoteDesktopHost();
  host.register('alice', []); host.register('bob', []);
  await host.request(opening, 'alice');
  await expect(host.request({ action: 'settings', id: 'desktop-1', settings: DEFAULT_SETTINGS }, 'bob'))
    .rejects.toThrow('连接已结束');
  await expect(host.request(opening, 'bob')).rejects.toThrow('已有');
  host.release('bob');
  expect(vi.mocked(DesktopHostSession).mock.results[0].value.closed).toBe(false);
  host.release('alice');
  expect(vi.mocked(DesktopHostSession).mock.results[0].value.closed).toBe(true);
});
it('closes an in-flight capture when the chat session expires', async () => {
  const host = new RemoteDesktopHost(); host.register('alice', []);
  const openingTask = host.request(opening, 'alice');
  host.release();
  await openingTask;
  expect(vi.mocked(DesktopHostSession).mock.results[0].value.closed).toBe(true);
  await expect(host.request({ action: 'signal', id: 'desktop-1', candidates: [] }, 'alice'))
    .rejects.toThrow('连接电脑');
});
