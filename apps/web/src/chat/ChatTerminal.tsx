import { lazy, Suspense, useMemo } from 'react';
import { Drawer, Spin } from 'antd';
import { SquareTerminal } from 'lucide-react';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { useTerminalPanel } from '../../../desktop/src/pages/codexGui/terminal/useTerminalPanel';
import { remoteTerminalApi } from '../../../../shared/remote-chat/terminalApi';
import { useDesktopLayout } from '../useDesktopLayout';
import { t, useLanguage } from '../i18n';
import './terminal.css';

const TerminalPanel = lazy(() => import('../../../desktop/src/pages/codexGui/terminal/TerminalPanel'));

/** The parent is keyed by computer, so a device switch also closes its terminal sessions. */
export function ChatTerminal({ client, cwd, active, connected, deviceName }: {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
}) {
  useLanguage();
  const desktop = useDesktopLayout();
  const panel = useTerminalPanel(cwd);
  const api = useMemo(() => remoteTerminalApi(client), [client]);
  const visible = active && !desktop && panel.open;
  const label = panel.open ? t('收起远程终端') : t('打开远程终端');
  return <>
    {!desktop && <button type="button" className="chat-terminal-toggle" aria-label={label}
      aria-expanded={visible} disabled={!connected && !panel.tabs.length} onClick={panel.toggle}>
      <SquareTerminal size={22} /></button>}
    {panel.tabs.length > 0 && <Drawer open={visible} placement="bottom" height="90%"
      title={t('远程终端')} extra={<span className="chat-terminal-device">{deviceName}</span>}
      rootClassName="chat-terminal-drawer" onClose={panel.hide}
      closable={{ 'aria-label': t('收起终端'), placement: 'end' }}>
      <Suspense fallback={<div className="chat-terminal-loading"><Spin />{t('正在打开终端…')}</div>}>
        <TerminalPanel panel={panel} api={api} active={visible} fill translate={t} />
      </Suspense>
    </Drawer>}
  </>;
}
