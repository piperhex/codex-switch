import { useState } from 'react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { t } from '../i18n';

export function HostIdentityVerification({ confirm, close }: {
  confirm: (fingerprint: string) => Promise<void>; close: () => void;
}) {
  const [fingerprint, setFingerprint] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await confirm(fingerprint); close(); }
    catch (error) { setError(error instanceof Error ? error.message : '电脑身份未能更新，请重试。'); }
    finally { setBusy(false); }
  };
  return <AdaptiveSheet open title={t('核对电脑身份')} width={400} onClose={close}>
    <div className="chat-settings" style={{ maxWidth: 400 }}>
      <p>{t('请在电脑的设置中找到“远程桌面”，复制设备指纹并粘贴到下方。')}</p>
      <input aria-label={t('设备指纹')} value={fingerprint} maxLength={100} autoComplete="off"
        style={{ width: '100%', boxSizing: 'border-box' }} onChange={event => setFingerprint(event.target.value)} />
      {!!error && <p role="alert">{t(error)}</p>}
      <button className="chat-button chat-primary" disabled={busy || !fingerprint.trim()} onClick={() => void submit()}>
        {t('核对并重新连接')}</button>
    </div>
  </AdaptiveSheet>;
}
