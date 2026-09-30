import { Button } from 'antd-mobile';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { useGuiUpdate, type GuiUpdateOptions } from '../../../../shared/remote-chat/useGuiUpdate';
import { t } from '../i18n';
import '../settings/desktop-version.css';

export function ChatGuiUpdateSheet({ deviceName, onClose, onBack, ...options }: GuiUpdateOptions & {
  deviceName?: string; onClose: () => void; onBack: () => void;
}) {
  const update = useGuiUpdate(options);
  return <AdaptiveSheet open title={t(update.confirmation ? '安装 Codex GUI 更新' : '更新 Codex GUI')}
    subtitle={deviceName || t('当前电脑')} width={400} onClose={onClose}
    onBack={update.confirmation ? update.cancel : onBack}>
    <div className="desktop-version">
      {update.confirmation ? <>
        <strong>v{update.confirmation}</strong>
        <p>{t('将在这台电脑上更新 Codex GUI，完成后自动重新连接。')}</p>
      </> : <dl>
        <dt>{t('当前版本')}</dt><dd>{update.version ? `v${update.version}` : t('暂未读取到版本')}</dd>
        {update.release && <><dt>{t('可用版本')}</dt><dd>v{update.release.version}</dd></>}
      </dl>}
      <p role="status">{t(update.message)}</p>
      {update.progress !== null && <progress aria-label={t('下载进度')} max={100} value={update.progress} />}
      {!!update.error && <p role="alert" className="desktop-version-error">{t(update.error)}</p>}
      <div className="desktop-version-actions">
        {update.confirmation ? <>
          <Button onClick={update.cancel}>{t('暂不安装')}</Button>
          <Button color="primary" disabled={!update.canConfirm} onClick={update.confirm}>{t('确认安装')}</Button>
        </> : <>
          <Button disabled={!update.canCheck} onClick={update.check}>{t('检查更新')}</Button>
          <Button color="primary" disabled={!update.canInstall} onClick={update.requestInstall}>{t('安装更新')}</Button>
        </>}
      </div>
    </div>
  </AdaptiveSheet>;
}
