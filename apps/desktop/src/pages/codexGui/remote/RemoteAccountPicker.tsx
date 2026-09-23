import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spin } from 'antd';
import { RefreshCw, Server, UserRound } from 'lucide-react';
import type { GuiAccountsClient, SelectableGuiAccount } from '../../../../../../shared/remote-chat/guiAccounts';
import { useGuiAccounts } from '../../../../../../shared/remote-chat/client/useGuiAccounts';
import { maskAccountEmail } from '../../../utils/accountPrivacy';
import { GuiAccountMenu } from '../GuiAccountMenu';
import { GuiAccountList } from '../GuiAccountList';
import type { GuiComputerNavigation } from './types';
import styles from '../ProxyAccountPicker.module.less';

const ACCOUNT_REFRESH_MS = 60_000;

export function RemoteAccountPicker({ active, ready, client, computers, privacyMode }: {
  active: boolean; ready: boolean; client: GuiAccountsClient; computers: GuiComputerNavigation; privacyMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const accounts = useGuiAccounts(client, ready && active, open ? ACCOUNT_REFRESH_MS : 0);
  const selection = accounts.snapshot?.selection;
  const current = accounts.snapshot?.choices.find((choice) => choice.kind === selection?.kind && choice.id === selection.id);
  const name = current ? privacyMode && current.kind === 'account' ? maskAccountEmail(current.name) : current.name
    : '选择 GUI 账户';
  const disabled = !ready || accounts.loading || Boolean(accounts.saving) || !accounts.snapshot?.running;
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  const select = async (kind: SelectableGuiAccount['kind'], id: string) => {
    if (await accounts.select({ kind, id })) { setOpen(false); trigger.current?.focus(); }
  };
  const choices = accounts.snapshot?.choices.map((choice) => ({ ...choice,
    selected: selection?.kind === choice.kind && selection.id === choice.id, disabled: !choice.available })) ?? [];
  const panel = (devicePicker: ReactNode) => <GuiAccountList choices={choices} devicePicker={devicePicker}
    disabled={disabled} loading={accounts.loading || Boolean(accounts.saving)}
    onSelectAccount={(id) => { void select('account', id); }}
    onSelectProvider={(id) => { void select('provider', id); }} footer={<>
      {!ready && <p className={styles.hint}>连接电脑后即可切换账户。</p>}
      {ready && accounts.snapshot && !accounts.snapshot.running
        && <p className={styles.hint}>请先在这台电脑上开启本地代理。</p>}
      {accounts.error && <p className={styles.error} role="alert">{accounts.error}</p>}
      <button type="button" className={styles.settings} aria-label="刷新账户列表"
        disabled={!ready || accounts.loading || Boolean(accounts.saving)} onClick={accounts.refresh}>
        <RefreshCw size={17} />刷新账户</button>
    </>} />;
  return <GuiAccountMenu active={active} open={open} trigger={trigger} name={name} computers={computers}
    busy={Boolean(accounts.saving)} accounts={panel}
    onOpenChange={(next) => { setOpen(next); if (next && ready) accounts.refresh(); }}
    icon={accounts.saving ? <Spin size="small" /> : current?.kind === 'provider' ? <Server size={17} /> : <UserRound size={17} />}
    summary={<span className={styles.remoteSummary}><span>{name}</span>
      <small>{ready ? current?.detail || '选择这台电脑的账户' : '等待连接电脑'}</small></span>} />;
}
