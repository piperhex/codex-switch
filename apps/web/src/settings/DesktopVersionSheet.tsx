import { useMemo, useState } from 'react';
import { Button } from 'antd-mobile';
import { apiJson, getActiveSession } from '../api';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { t } from '../i18n';
import { useDesktopUpdate } from '../../../../shared/desktop-update/useDesktopUpdate';
import type { UpdateConnectionOptions } from '../../../../shared/desktop-update/connection';
import './desktop-version.css';

export function DesktopVersionSheet({ onClose, connectionOptions }: {
  onClose: () => void; connectionOptions?: UpdateConnectionOptions;
}) {
  const options = useMemo(() => connectionOptions ?? { authorize: async () => {
    await apiJson('/auth/me');
    const session = getActiveSession();
    if (!session) throw new Error('请重新登录。');
    return session;
  } }, [connectionOptions]);
  const update = useDesktopUpdate(options);
  const [confirmation, setConfirmation] = useState<{ deviceId: string; version: string } | null>(null);
  const status = update.status;
  const canConfirm = update.canInstall && confirmation?.deviceId === update.selectedId
    && confirmation.version === status?.latestVersion;
  const install = () => {
    if (!canConfirm || !confirmation) return;
    update.install(confirmation.version);
    setConfirmation(null);
  };
  return <AdaptiveSheet open title={confirmation ? t('安装电脑端更新') : t('电脑端版本')} onClose={onClose} width={400}>
    <div className="desktop-version">
      {confirmation ? <>
        <strong>{update.device?.name} · v{confirmation.version}</strong>
        <p>{t('安装后电脑端会重启，正在进行的连接和任务可能中断。请先保存工作。')}</p>
        <div className="desktop-version-actions">
          <Button onClick={() => setConfirmation(null)}>{t('暂不安装')}</Button>
          <Button color="primary" disabled={!canConfirm} onClick={install}>{t('安装并重启')}</Button>
        </div>
      </> : <>
        <label htmlFor="desktop-version-device">{t('选择电脑')}</label>
        {!update.connected && <p>{t('正在连接…')}</p>}
        {update.connected && !update.devices.length && <p>{t('暂无电脑，请先在电脑端登录同一账号。')}</p>}
        {!!update.devices.length && <select id="desktop-version-device" value={update.selectedId}
          onChange={(event) => update.select(event.target.value)}>
          {update.devices.map((device) => <option key={device.deviceId} value={device.deviceId}>
            {device.name} · {device.platform} · {t(device.online ? '在线' : '离线')}
          </option>)}
        </select>}
        {update.device && <>
          <dl><dt>{t('当前版本')}</dt><dd>{status?.currentVersion || update.device.appVersion || t('暂未读取到版本')}</dd>
            {status?.latestVersion && <><dt>{t('可用版本')}</dt><dd>v{status.latestVersion}</dd></>}
          </dl>
          {(!status || !update.connected || !update.device.online) && update.device.appVersion
            && <p>{t('上次连接时的版本')}</p>}
          <p role="status">{t(update.message)}</p>
          {status?.phase === 'downloading' && status.progress !== null
            && <progress aria-label={t('下载进度')} max={100} value={status.progress} />}
          {status?.notes && <div className="desktop-version-notes">{status.notes}</div>}
        </>}
        <div className="desktop-version-actions">
          <Button disabled={!update.canCheck} onClick={update.check}>{t('检查更新')}</Button>
          <Button color="primary" disabled={!update.canInstall} onClick={() => {
            if (status?.latestVersion) setConfirmation({ deviceId: update.selectedId, version: status.latestVersion });
          }}>{t('安装更新')}</Button>
        </div>
      </>}
      {!!update.error && <p role="alert" className="desktop-version-error">{t(update.error)}</p>}
    </div>
  </AdaptiveSheet>;
}
