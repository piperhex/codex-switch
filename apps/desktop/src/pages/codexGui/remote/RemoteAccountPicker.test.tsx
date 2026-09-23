// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GuiAccountsClient, GuiAccountsSnapshot } from '../../../../../../shared/remote-chat/guiAccounts';
import { RemoteAccountPicker } from './RemoteAccountPicker';
import type { GuiComputerNavigation } from './types';

let root: Root;
let container: HTMLDivElement;
let client: GuiAccountsClient;
let ready: boolean;
let computers: GuiComputerNavigation;
const accountSnapshot: GuiAccountsSnapshot = { running: true, selection: { kind: 'account', id: 'remote-account' },
  choices: [{ kind: 'account', id: 'remote-account', name: 'remote@example.com', detail: 'Plus', available: true },
    { kind: 'provider', id: 'remote-provider', name: 'Remote Provider', detail: 'Model', available: true }] };
function Harness() { return <RemoteAccountPicker active ready={ready} client={client} computers={computers}
  privacyMode={false} />; }
const render = () => act(async () => root.render(<Harness />));
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (target: HTMLButtonElement) => act(async () => target.click());
async function accounts() {
  await click(container.querySelector('button')!);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => original(element));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  ready = true;
  client = { read: vi.fn().mockResolvedValue(accountSnapshot), select: vi.fn().mockResolvedValue({ kind: 'provider',
    id: 'remote-provider' }), subscribe: vi.fn().mockReturnValue(vi.fn()) };
  const current = { deviceId: 'work-pc', name: 'Work PC', online: true, platform: 'windows' };
  computers = { current, devices: [current, { ...current, deviceId: 'offline', name: 'Offline PC', online: false }],
    authenticated: true, loading: false, error: '', choose: vi.fn(), refresh: vi.fn(), login: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens the account list directly and switches the selected computer through its client', async () => {
  await render();
  expect(container.textContent).toContain('Work PC');
  await accounts();
  await click(document.querySelector<HTMLButtonElement>('[role="tab"][data-tab="provider"]')!);
  const provider = Array.from(document.querySelectorAll<HTMLButtonElement>('section button'))
    .find(entry => entry.textContent?.includes('Remote Provider'))!;
  await click(provider);
  expect(client.select).toHaveBeenCalledWith({ kind: 'provider', id: 'remote-provider' });
  expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
});

it('can return to this computer while offline without switching a local account', async () => {
  ready = false; await render();
  await click(container.querySelector('button')!); await click(button('切换设备'));
  const choices = Array.from(document.querySelectorAll<HTMLButtonElement>('section[aria-label="设备列表"] button'));
  expect(choices.find(entry => entry.textContent?.includes('Offline PC'))?.disabled).toBe(true);
  await click(choices.find(entry => entry.textContent?.includes('本机'))!);
  expect(computers.choose).toHaveBeenCalledWith(null);
  expect(client.read).not.toHaveBeenCalled(); expect(client.select).not.toHaveBeenCalled();
});

it('discards a slow account catalog when changing to another computer', async () => {
  let finish!: (snapshot: GuiAccountsSnapshot) => void;
  client.read = vi.fn(() => new Promise<GuiAccountsSnapshot>(resolve => { finish = resolve; }));
  await render();
  client = { ...client, read: vi.fn().mockResolvedValue({ ...accountSnapshot, choices: [{ ...accountSnapshot.choices[0],
    name: 'other@example.com' }] }) };
  computers = { ...computers, current: { ...computers.current!, deviceId: 'next', name: 'Next PC' } };
  await render(); await act(async () => finish(accountSnapshot));
  expect(container.textContent).toContain('other@example.com'); expect(container.textContent).not.toContain('remote@example.com');
});

it('closes only the device dropdown with Escape and keeps account browsing available during discovery', async () => {
  await render(); await accounts();
  const deviceButton = button('切换设备');
  await click(deviceButton);
  expect(computers.refresh).toHaveBeenCalledOnce();
  computers = { ...computers, loading: true };
  await render();
  expect(button('刷新设备列表').disabled).toBe(true);
  await act(async () => deviceButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(deviceButton.getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(deviceButton);
  const providerTab = document.querySelector<HTMLButtonElement>('[role="tab"][data-tab="provider"]')!;
  await click(providerTab);
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain('Remote Provider');
  await click(button('关闭账户面板'));
  expect(document.activeElement).toBe(container.querySelector('button'));
});

it('filters within each account tab, supports keyboard navigation and resets search on reopen', async () => {
  await render(); await accounts();
  const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索账号或邮箱"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'missing');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain('暂无匹配项');
  expect(document.querySelector('[role="tab"][data-tab="account"]')?.textContent).toContain('(1)');
  await click(button('关闭账户面板')); await accounts();
  expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('');
  const accountTab = document.querySelector<HTMLButtonElement>('[role="tab"][data-tab="account"]')!;
  await act(async () => accountTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  const providerTab = document.querySelector<HTMLButtonElement>('[role="tab"][data-tab="provider"]')!;
  expect(providerTab.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(providerTab);
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain('remote@example.com');
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain('Remote Provider');
});
