import { invoke } from '../api/backend';
import type { Account, LocalProxyStatus, Provider } from '../types';
import { object } from '../../../../shared/remote-chat/protocol';
import type { GuiAccountSelection, GuiAccountsSnapshot } from '../../../../shared/remote-chat/guiAccounts';

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
        detail: account.note || account.plan || 'ChatGPT', available: account.localProxyCompatible,
      })),
      ...providers.map((provider) => ({
        kind: 'provider' as const, id: provider.id, name: provider.name,
        detail: provider.model || '第三方账户', available: true,
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
