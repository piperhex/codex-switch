import { lazy, Suspense, useMemo } from 'react';
import { Drawer, Spin } from 'antd';
import { SquareTerminal } from 'lucide-react';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { useRemoteTerminalPanel } from '../../../../shared/remote-chat/useRemoteTerminalPanel';
import { remoteTerminalApi } from '../../../../shared/remote-chat/terminalApi';
import { useDesktopLayout } from '../useDesktopLayout';
import { t, useLanguage } from '../i18n';
import './terminal.css';

const TerminalPanel = lazy(() => import('../../../desktop/src/pages/codexGui/terminal/TerminalPanel'));

/** Switching projects detaches the view; each PC retains the project's terminal sessions. */
export function ChatTerminal({ client, cwd, active, connected, deviceName }: {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
}) {
  useLanguage();
  const desktop = useDesktopLayout();
  const panel = useRemoteTerminalPanel({ client, cwd, connected });
  const api = useMemo(() => remoteTerminalApi(client), [client]);
  const visible = active && panel.open;
  const label = panel.open ? t('收起远程终端') : t('打开远程终端');
  return <>
    <button type="button" className="chat-terminal-toggle" aria-label={label}
      aria-expanded={visible} disabled={panel.busy || (!connected && !panel.tabs.length)} onClick={panel.toggle}>
      <SquareTerminal size={22} /></button>
    {panel.error && !visible && <span role="alert" style={{ maxWidth: 400 }}>{t(panel.error)}</span>}
    {panel.tabs.length > 0 && <Drawer open={visible} placement={desktop ? 'right' : 'bottom'}
      height="90%" width={desktop ? '70%' : undefined}
      title={t('远程终端')} extra={<span className="chat-terminal-device">{deviceName}</span>}
      rootClassName="chat-terminal-drawer" onClose={panel.hide}
      closable={{ 'aria-label': t('收起终端'), placement: 'end' }}>
      <Suspense fallback={<div className="chat-terminal-loading"><Spin />{t('正在打开终端…')}</div>}>
        <TerminalPanel panel={panel} api={api} active={visible} fill translate={t} notice={panel.error} />
      </Suspense>
    </Drawer>}
  </>;
}
