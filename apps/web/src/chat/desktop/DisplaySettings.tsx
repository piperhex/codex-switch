import { useState } from 'react';
import { MAX_FPS, type DesktopSettings } from '../../../../../shared/remote-desktop/protocol';
import { t } from '../../i18n';

export function DisplaySettings({ settings, update, saving, close }: {
  settings: DesktopSettings; update: (settings: DesktopSettings) => Promise<void>; saving: boolean; close: () => void;
}) {
  const [custom, setCustom] = useState(settings.fps === 'auto' ? 30 : settings.fps);
  const [error, setError] = useState('');
  const apply = () => {
    if (!Number.isInteger(custom) || custom < 1 || custom > MAX_FPS) { setError('请输入 1–144 的整数。'); return; }
    setError(''); void update({ ...settings, fps: custom });
  };
  return <aside className="rd-settings" aria-label={t('显示设置')}>
    <header><strong>{t('显示')}</strong><button onClick={close}>{t('完成')}</button></header>
    <p>{t('帧率')}</p><div className="rd-options" role="group" aria-label={t('帧率')}>
      {(['auto', 30, 60, 90, 144] as const).map(fps => <button key={fps} disabled={saving}
        aria-pressed={settings.fps === fps} onClick={() => { void update({ ...settings, fps }); }}>
        {fps === 'auto' ? t('自动') : `${fps} ${t('帧')}`}</button>)}
    </div><div className="rd-custom"><input type="number" min={1} max={MAX_FPS} step={1} value={custom}
      aria-label={t('自定义帧率')} onChange={event => setCustom(Number(event.target.value))} />
      <button disabled={saving} onClick={apply}>{t('应用帧率')}</button></div>
    {error && <p role="alert">{t(error)}</p>}
    <small>{t('支持 1–144 帧。实际帧率取决于网络和电脑性能。')}</small>
    <p>{t('画质')}</p><div className="rd-options" role="group" aria-label={t('画质')}>
      {([{ value: 'auto', label: '自动' }, { value: 'smooth', label: '流畅' },
        { value: 'clear', label: '高清' }, { value: 'original', label: '超清' }] as const).map(item =>
        <button key={item.value} disabled={saving} aria-pressed={settings.quality === item.value}
          onClick={() => { void update({ ...settings, quality: item.value }); }}>{t(item.label)}</button>)}
    </div><small>{t('默认根据网络情况调整画质和帧率，让操作保持流畅。')}</small>
    <p>{t('鼠标操作')}</p><small>
      {t('滑动画面或鼠标下半部移动指针，轻点单击。长按左键开始拖拽，再点左键结束。中央箭头用于滚动，横线把手可移动鼠标面板。')}
    </small>
  </aside>;
}
