import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { BarChart3, Monitor, User } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { GuiAccountChoice, GuiAccountsClient } from '../../../../shared/remote-chat/guiAccounts';
import { useGuiAccounts } from '../../../../shared/remote-chat/client/useGuiAccounts';

const ACCOUNT_REFRESH_MS = 60_000;
export interface ChatConnectionProps {
  client: GuiAccountsClient; deviceName: string; chooseDevice: () => void;
}
type Props = ChatConnectionProps & { ready: boolean } & (
  { variant: 'settings' } | { variant?: 'avatar'; email: string; openTokenSummary: () => void }
);

export function ChatProfileMenu(props: Props) {
  const { client, deviceName, ready, chooseDevice } = props;
  const settings = props.variant === 'settings';
  useLanguage();
  const [panel, setPanel] = useState<'profile' | 'accounts' | null>(null);
  const [query, setQuery] = useState('');
  const accounts = useGuiAccounts(client, ready, panel === 'accounts' ? ACCOUNT_REFRESH_MS : 0);
  const selection = accounts.snapshot?.selection;
  const current = accounts.snapshot?.choices.find(choice => selection?.kind === choice.kind && selection.id === choice.id);
  const disabled = accounts.loading || Boolean(accounts.saving) || !ready || !accounts.snapshot?.running;
  const choices = accounts.snapshot?.choices.filter(choice =>
    `${choice.name} ${choice.detail} ${choice.searchDetail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const select = async (choice: GuiAccountChoice) => {
    if (!disabled && choice.available && choice !== current
      && await accounts.select({ kind: choice.kind, id: choice.id })) setPanel(settings ? null : 'profile');
  };
  const close = () => { if (!accounts.saving) setPanel(null); };
  const connectionOptions = <>
    <button type="button" className="chat-profile-option" aria-label={t("切换电脑")}
      onClick={() => { close(); chooseDevice(); }}><Monitor size={22} /><span className="chat-grow">
        <strong>{t("切换电脑")}</strong><small>{deviceName}</small></span><span>›</span></button>
    <button type="button" className="chat-profile-option" aria-label={t("切换账户")}
      onClick={() => { setQuery(''); setPanel('accounts'); if (ready) accounts.refresh(); }}>
      <User size={22} /><span className="chat-grow"><strong>{t("切换账户")}</strong>
        <small>{current?.name || t("选择账户")}</small></span><span>›</span></button>
  </>;
  return <>
    {settings ? connectionOptions : <button type="button" className="chat-profile-avatar"
      aria-label={t("打开头像菜单")} aria-expanded={panel !== null} onClick={() => setPanel('profile')}>
      {Array.from(current?.name.trim() || '').slice(0, 2).join('') || t("我")}</button>}
    {panel && <AdaptiveSheet open title={panel === 'accounts' ? t("切换账户") : t("账户与电脑")} width={400}
      subtitle={panel === 'accounts' ? t("与电脑共用当前聊天账户") : undefined} onClose={close}
      onBack={panel === 'accounts' && !accounts.saving ? () => setPanel(settings ? null : 'profile') : undefined}>
      {panel === 'profile' && props.variant !== 'settings' ? <div className="chat-detail-stack">
        <p className="chat-muted">{props.email}</p>
        {connectionOptions}
        <button type="button" className="chat-profile-option" aria-label={t("Token 汇总")}
          onClick={() => { close(); props.openTokenSummary(); }}><BarChart3 size={22} /><span className="chat-grow">
            <strong>{t("Token 汇总")}</strong><small>{t("查看用量趋势与消耗排行")}</small></span><span>›</span></button>
      </div> : <div className="chat-detail-stack">
        <input className="chat-answer" aria-label={t("搜索账户")} placeholder={t("搜索名称或备注")} value={query}
          onChange={event => setQuery(event.target.value)} />
        {!ready && <p className="chat-muted">{t("连接电脑后即可切换账户。")}</p>}
        {accounts.loading && <p role="status">{t("正在同步账户…")}</p>}
        {ready && accounts.snapshot && !accounts.snapshot.running && <p className="chat-muted">
          {t("请先在电脑上开启本地代理，再切换账户。")}</p>}
        {accounts.error && <><p role="alert" className="chat-error">{t(accounts.error)}</p>
          <button type="button" className="chat-button" disabled={!ready || accounts.loading || Boolean(accounts.saving)}
            onClick={accounts.refresh}>{t("重试读取账户")}</button></>}
        <div className="chat-account-choices chat-scroll">{choices.map(choice => <button type="button"
          key={`${choice.kind}:${choice.id}`} className="chat-profile-option" aria-label={choice.name}
          aria-pressed={choice === current} disabled={disabled || choice === current || !choice.available}
          onClick={() => { void select(choice); }}><span className="chat-grow"><strong>{choice.name}</strong>
            <small>{choice.detail}</small>{!choice.available && <small>{t("此账户暂不可用")}</small>}</span>
          {accounts.saving === `${choice.kind}:${choice.id}` ? t("正在切换…") : choice === current && t("当前")}</button>)}
          {!choices.length && accounts.snapshot && !accounts.loading && <p className="chat-muted">
            {accounts.snapshot.choices.length ? t("没有找到匹配的账户。") : t("暂无可选账户，请先在电脑上添加账户。")}</p>}
        </div>
      </div>}
    </AdaptiveSheet>}
  </>;
}
