import { afterEach, expect, it, vi } from 'vitest';
import { DesktopHostSession } from './session';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

vi.mock('./capture', () => ({ DesktopCapture: class { close = vi.fn(); } }));
vi.mock('./controls', () => ({ DesktopControls: class { close = vi.fn(); } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps browser capture alive after candidate rejection while retaining the session input limit', async () => {
  vi.useFakeTimers();
  const channel = { addEventListener: vi.fn(), close: vi.fn() };
  const add = vi.fn().mockRejectedValueOnce(new DOMException('private', 'OperationError'))
    .mockResolvedValue(undefined);
  vi.stubGlobal('RTCPeerConnection', class {
    createDataChannel = () => channel;
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    addIceCandidate = add;
    close = vi.fn();
  });
  const diagnostic = vi.fn();
  const host = new DesktopHostSession(DEFAULT_SETTINGS, [], undefined, diagnostic);
  const candidates = ['hidden.local', '192.0.2.1'].map(address => ({
    candidate: `candidate:1 1 udp 1 ${address} 40000 typ host`,
  }));
  try {
    await expect(host.signal({ candidates })).resolves.toEqual({ candidates: [] });
    expect(add.mock.calls.map(([candidate]) => candidate)).toEqual(candidates);
    expect(host.closed).toBe(false);
    expect(diagnostic).toHaveBeenCalledWith('candidate-rejected', expect.objectContaining({ addressKind: 'mdns' }));
    await expect(host.signal({ candidates: Array.from({ length: 127 }, () => candidates[1]) }))
      .rejects.toThrow('桌面连接信息无效');
    expect(add).toHaveBeenCalledTimes(2);
  } finally { await host.close(); }
  expect(vi.getTimerCount()).toBe(0);
});
