// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDesktopSession } from '../../../../shared/remote-desktop/useDesktopSession';
import type { DesktopClient, DesktopDisplays, DesktopSettings } from '../../../../shared/remote-desktop/protocol';

interface FakeSession {
  options: { stream: (stream?: MediaStream) => void; displays: (value: DesktopDisplays) => void };
  start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; input: ReturnType<typeof vi.fn>;
}
const runtime = vi.hoisted(() => ({ sessions: [] as FakeSession[] }));
vi.mock('../../../../shared/remote-desktop/receiver', () => ({ DesktopReceiver: class {
  start = vi.fn(async () => {
    this.options.displays({ displays: [], displayId: 'first' });
    this.options.stream({} as MediaStream);
  });
  stop = vi.fn(async () => { this.options.stream(undefined); });
  input = vi.fn(); settings = vi.fn(); mute = vi.fn();
  constructor(public options: FakeSession['options']) { runtime.sessions.push(this); }
} }));
const client: DesktopClient = { open: vi.fn(), signal: vi.fn(), settings: vi.fn(), close: vi.fn() };
const createPeer = vi.fn();
let root: Root;
let session: ReturnType<typeof useDesktopSession>;
function Harness({ active = true }) { session = useDesktopSession({ client, active, createPeer }); return null; }
beforeEach(async () => {
  runtime.sessions.length = 0; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('releases dragging and waits for close before reconnecting with the chosen screen', async () => {
  const old = runtime.sessions[0];
  let release!: () => void;
  const closed = new Promise<void>(resolve => { release = resolve; });
  old.stop.mockImplementation(() => closed);
  act(() => session.pointer.button('left', true));
  const next: DesktopSettings = { fps: 90, quality: 'clear', displayId: 'second' };
  let switching!: Promise<void>;
  await act(async () => { switching = session.update(next); });
  expect(old.input).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: false });
  expect(session.saving).toBe(true); expect(runtime.sessions).toHaveLength(1);
  await act(async () => session.update({ ...next, displayId: 'third' }));
  expect(old.stop).toHaveBeenCalledOnce();
  await act(async () => { release(); await switching; });
  expect(runtime.sessions).toHaveLength(2);
  expect(runtime.sessions[1].start).toHaveBeenCalledWith(next);
  // The host may fall back to its primary display if the requested screen was removed.
  expect(session.settings.displayId).toBe('first');
});

it('does not reopen a screen when the viewer closes during a pending switch', async () => {
  let release!: () => void;
  runtime.sessions[0].stop.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  let switching!: Promise<void>;
  await act(async () => { switching = session.update({ ...session.settings, displayId: 'second' }); });
  const finishSwitch = release;
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => { finishSwitch(); await switching; release(); });
  expect(runtime.sessions).toHaveLength(1);
});
