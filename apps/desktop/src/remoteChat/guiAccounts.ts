import { invoke } from '../api/backend';
import type { Account, LocalProxyStatus, Provider } from '../types';
import { object } from '../../../../shared/remote-chat/protocol';
import type { GuiAccountSelection, GuiAccountsSnapshot } from '../../../../shared/remote-chat/guiAccounts';
import { guiAccountBalances } from './guiAccountBalances';

function remainingPercent(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function accountDetail(account: Account) {
  const plan = account.plan?.trim() || account.usage?.plan?.trim() || '套餐未知';
  const primary = remainingPercent(account.usage?.primary?.remainingPercent);
  const secondary = remainingPercent(account.usage?.secondary?.remainingPercent);
  return `${plan} · 主剩余 ${primary} · 次剩余 ${secondary}`;
}

export async function readGuiAccounts(): Promise<GuiAccountsSnapshot> {
  const [selection, accounts, providers, proxy] = await Promise.all([
    invoke<GuiAccountSelection>('codex_gui_account_selection'),
    invoke<Account[]>('list_accounts'),
    invoke<Provider[]>('list_providers'),
    invoke<LocalProxyStatus>('get_local_proxy_status'),
  ]);
  // Only send picker copy over the chat link; account credentials and private details stay on the computer.
  return {
    selection, running: proxy.running,
    choices: [
      ...accounts.map((account) => ({
        kind: 'account' as const, id: account.id, name: account.email,
        detail: accountDetail(account), searchDetail: account.note, available: account.localProxyCompatible,
      })),
      ...providers.map((provider) => ({
        kind: 'provider' as const, id: provider.id, name: provider.name,
        detail: guiAccountBalances.detail(provider), searchDetail: provider.model, available: true,
      })),
    ],
  };
}

export async function selectGuiAccount(value: unknown): Promise<GuiAccountSelection> {
  const selection = object(value);
  if (!['account', 'provider'].includes(String(selection.kind))
    || typeof selection.id !== 'string' || !selection.id.trim() || selection.id.length > 160) {
    return Promise.reject(new Error('请选择可用账户。'));
  }
  return invoke<GuiAccountSelection>('codex_gui_switch_account', {
    selection: { kind: selection.kind, id: selection.id },
  });
}
