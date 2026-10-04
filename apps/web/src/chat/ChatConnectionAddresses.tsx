import { connectionEndpointRows } from '../../../../shared/remote-chat/connectionEndpoints';
import { publicEndpointRows } from '../../../../shared/remote-chat/publicEndpoints';
import { t } from '../i18n';
import type { ChatState } from './types';

export function ChatConnectionAddresses({ state }: { state: ChatState }) {
  const current = connectionEndpointRows(state.mode, state.directEndpoints);
  return <>
    {current.length > 0 && <section className="connection-health-addresses connection-health-direct"
      aria-label={t('当前 P2P 连接')}>
      <h3>{t('当前 P2P 连接')}</h3>
      <dl>{current.map(row => <div key={row.id}>
        <dt>{t(row.label)}</dt>
        <dd>{row.address ? <span>{row.address}</span>
          : <span className="connection-health-address-unknown">{t('暂无法获取')}</span>}</dd>
      </div>)}</dl>
      <p>{t('优先显示当前连接对应的公网地址，无法确认时显示本地地址。')}</p>
    </section>}
    <div className="connection-health-addresses connection-health-public">
      <dl>{publicEndpointRows(state.publicEndpoints).map(row => <div key={row.id}>
        <dt>{t(row.label)}</dt>
        <dd>{row.addresses.length ? row.addresses.map(address => <span key={address}>{address}</span>)
          : <span className="connection-health-address-unknown">{t('尚未识别')}</span>}</dd>
      </div>)}</dl>
      <p>{t('显示本次连接识别到的公网地址。')}</p>
    </div>
  </>;
}
