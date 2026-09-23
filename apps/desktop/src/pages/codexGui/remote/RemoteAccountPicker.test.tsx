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
const accountList = () => document.querySelector('section[aria-label="账户列表"]')!;
const searchInput = () => document.querySelector<HTMLInputElement>('input[aria-label="搜索账号或 Provider"]')!;
const escape = (target: HTMLElement) => act(async () => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});
const search = (value: string) => act(async () => {
  const input = searchInput();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
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
  expect(accountList().textContent).toContain('Remote Provider');
  await escape(searchInput());
  expect(document.activeElement).toBe(container.querySelector('button'));
});

it('shows both account types together, searches across them and resets search on reopen', async () => {
  await render(); await accounts();
  expect(document.querySelector('[role="tablist"]')).toBeNull();
  expect(accountList().textContent).toContain('remote@example.com');
  expect(accountList().textContent).toContain('Remote Provider');
  expect(accountList().querySelector('[role="img"][aria-label="官方账号"]')).not.toBeNull();
  expect(accountList().querySelector('[role="img"][aria-label="第三方 Provider"] svg')).not.toBeNull();
  await search('provider');
  expect(accountList().textContent).not.toContain('remote@example.com');
  expect(accountList().textContent).toContain('Remote Provider');
  await search('remote@');
  expect(accountList().textContent).toContain('remote@example.com');
  expect(accountList().textContent).not.toContain('Remote Provider');
  await search('missing');
  expect(accountList().textContent).toContain('暂无匹配项');
  await escape(searchInput()); await accounts();
  expect(searchInput().value).toBe('');
  expect(accountList().querySelectorAll('button')).toHaveLength(2);
});

it('distinguishes an account and provider that share the same id', async () => {
  client.read = vi.fn().mockResolvedValue({ ...accountSnapshot,
    choices: accountSnapshot.choices.map(choice => ({ ...choice, id: 'remote-account' })) });
  await render(); await accounts();
  const choices = accountList().querySelectorAll<HTMLButtonElement>('button');
  expect(choices).toHaveLength(2);
  expect(choices[0].getAttribute('aria-pressed')).toBe('true');
  expect(choices[1].getAttribute('aria-pressed')).toBe('false');
  await click(choices[1]);
  expect(client.select).toHaveBeenCalledWith({ kind: 'provider', id: 'remote-account' });
});
