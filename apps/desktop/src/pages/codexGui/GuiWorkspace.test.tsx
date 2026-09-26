// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { GuiWorkspace } from './GuiWorkspace';
import type { GuiComputer } from './remote/types';

const fixture = vi.hoisted(() => ({ current: null as GuiComputer | null, mounts: 0, stops: 0,
  notify: (_message: string) => {} }));
vi.mock('../../api/backend', () => ({ isDesktopApp: true }));
vi.mock('./remote/useGuiComputers', () => ({ useGuiComputers: () => ({
  current: fixture.current, identity: { baseUrl: 'https://fixture.test', userId: 'owner' }, devices: [],
}) }));
vi.mock('./useGuiLayout', () => ({ useGuiLayout: () => ({ focused: false, onToggleFocus() {} }) }));
vi.mock('./useGuiAccountSelection', () => ({ useGuiAccountSelection: () => ({ accounts: [], providers: [] }) }));
vi.mock('./ProxyAccountPicker', () => ({ ProxyAccountPicker: () => null }));
vi.mock('./remote/RemoteGuiWorkspace', () => ({ default: () => <div>Remote workspace</div> }));
vi.mock('../CodexGuiPage', () => ({ CodexGuiPage: function LocalConversation({ active }: { active: boolean }) {
  const [draft, setDraft] = useState('unfinished local draft');
  const [reply, setReply] = useState('streaming');
  useEffect(() => {
    fixture.mounts++; fixture.notify = setReply;
    return () => { fixture.stops++; fixture.notify = () => {}; };
  }, []);
  return <div data-local-active={active}><input value={draft} onChange={event => setDraft(event.target.value)} />
    <output>{reply}</output></div>;
} }));

let root: Root;
let host: HTMLDivElement;
const render = () => act(async () => root.render(<GuiWorkspace active accounts={[]} providers={[]}
  privacyMode={false} loading={false} plugins={{ authenticated: true, baseUrl: 'https://fixture.test',
    currentUserId: 'owner', onLogin() {}, notify() {}, t: text => text }} />));
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('keeps the local conversation mounted, receiving replies and preserving its draft across remote switches', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
  const local = host.querySelector('[data-local-active]')!;
  fixture.current = { deviceId: 'one', name: 'Office', platform: 'windows', online: true };
  await render();
  expect(local.closest('[hidden]')).not.toBeNull();
  await act(async () => fixture.notify('reply received while viewing remote computer'));
  fixture.current = { ...fixture.current, deviceId: 'two' }; await render();
  expect(fixture.mounts).toBe(1); expect(fixture.stops).toBe(0);
  fixture.current = null; await render();
  expect(host.querySelector('[data-local-active]')).toBe(local);
  expect(local.closest('[hidden]')).toBeNull();
  expect(local.querySelector('output')?.textContent).toBe('reply received while viewing remote computer');
  expect(local.querySelector('input')?.value).toBe('unfinished local draft');
  expect(fixture.stops).toBe(0);
});
