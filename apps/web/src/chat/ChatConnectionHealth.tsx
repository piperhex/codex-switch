import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { t, useLanguage } from '../i18n';
import { connectionHealth } from '../../../../shared/remote-chat/connectionHealth';
import type { ChatState } from './types';

export function ChatConnectionHealth({ state, device, reconnect, close }: {
  state: ChatState; device?: { online: boolean }; reconnect: () => void; close: () => void;
}) {
  useLanguage();
  const health = connectionHealth(state, device);
  return <AdaptiveSheet open title={t('连接体检')} onClose={close} width={400}>
    <div style={{ maxWidth: 400, width: '100%', margin: '0 auto', overflowWrap: 'anywhere' }}>
      <strong>{t(health.title)}</strong>
      <dl>{health.steps.map(step => <div key={step.label} style={{ marginTop: 12 }}>
        <dt>{t(step.label)} · {t({ ok: '正常', waiting: '待确认', blocked: '需要处理' }[step.status])}</dt>
        <dd className="chat-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{t(step.detail)}</dd>
      </div>)}</dl>
      <p>{t(health.next)}</p>
      {health.reconnect && <button type="button" className="chat-button" onClick={reconnect}>{t('重新连接')}</button>}
    </div>
  </AdaptiveSheet>;
}
