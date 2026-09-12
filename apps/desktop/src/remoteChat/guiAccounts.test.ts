// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../api/backend';
import { readGuiAccounts, selectGuiAccount } from './guiAccounts';
import { ChatOperations } from './operations';

vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

it('reads the independent GUI account and sends only picker fields from this computer', async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'codex_gui_account_selection') return { kind: 'account', id: 'gui' };
    if (command === 'get_local_proxy_status') return { running: true };
    if (command === 'list_accounts') return [
      { id: 'global', email: 'global@example.test', active: true, localProxyCompatible: true,
        privateDetails: { password: 'private' }, codexAccessToken: 'secret' },
      { id: 'gui', email: 'gui@example.test', note: '工作', plan: 'pro', active: false,
        localProxyCompatible: true, usage: {
          primary: { remainingPercent: 82.4 }, secondary: { remainingPercent: 0 },
        } },
    ];
    if (command === 'list_providers') return [{ id: 'provider', name: 'Provider', model: 'model', apiKey: 'secret' }];
    throw new Error('Unexpected command');
  });
  const snapshot = await readGuiAccounts();
  expect(snapshot.selection).toEqual({ kind: 'account', id: 'gui' });
  expect(snapshot.choices).toEqual([
    { kind: 'account', id: 'global', name: 'global@example.test',
      detail: '套餐未知 · 主剩余 — · 次剩余 —', available: true },
    { kind: 'account', id: 'gui', name: 'gui@example.test',
      detail: 'pro · 主剩余 82% · 次剩余 0%', searchDetail: '工作', available: true },
    { kind: 'provider', id: 'provider', name: 'Provider',
      detail: '钱包余额 暂无余额', searchDetail: 'model', available: true },
  ]);
  expect(JSON.stringify(snapshot)).not.toMatch(/secret|privateDetails|password|apiKey/);
});

it.each([null, {}, { kind: 'none' }, { kind: 'account', id: '' },
  { kind: 'provider', id: ' ' }, { kind: 'account', id: 'x'.repeat(161) },
  { kind: 'command', id: 'anything' }])('rejects invalid selection %j before IPC', async (value) => {
  await expect(selectGuiAccount(value)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it('retries a mobile switch exactly once and never changes the global account', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'switch:1', method: 'request' as const,
    body: { operation: 'guiAccountSelect', selection: { kind: 'account', id: 'gui', ignored: 'extra' } } };
  const pending = operations.execute(request);
  const retried = operations.execute(request);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_switch_account',
    { selection: { kind: 'account', id: 'gui' } });
  finish({ kind: 'account', id: 'gui' });
  expect(await retried).toEqual(await pending);
});

it('supports selecting a GUI provider through the same isolated command', async () => {
  vi.mocked(invoke).mockResolvedValue({ kind: 'provider', id: 'provider' });
  await expect(selectGuiAccount({ kind: 'provider', id: 'provider' }))
    .resolves.toEqual({ kind: 'provider', id: 'provider' });
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_switch_account',
    { selection: { kind: 'provider', id: 'provider' } });
});
