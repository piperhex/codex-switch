import { X } from 'lucide-react';
import type { DesktopStats as Stats } from '../../../../../shared/remote-desktop/protocol';
import { desktopStatsLines } from '../../../../../shared/remote-desktop/stats';
import { t } from '../../i18n';

export function DesktopStats({ stats, close }: { stats: Stats; close: () => void }) {
  return <div className="rd-stats">
    <span aria-label={t('连接状态')}>{desktopStatsLines(stats, t).join('\n')}</span>
    <button aria-label={t('关闭连接状态')} onClick={close}><X size={18} /></button>
  </div>;
}
