import { useState } from 'react';
import { Alert, Button, Popover, Tooltip } from 'antd';
import { Download, PanelBottom, RefreshCw } from 'lucide-react';
import type { ChatState } from '../../../../../../shared/remote-chat/client/types';
import type { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import type { TerminalPanelState } from '../terminal/useTerminalPanel';
import { Installer } from '../Installer';
import { useRemoteCliInstaller } from './useRemoteCliInstaller';

export function RemoteGuiTools({ controller, state, active, terminal }: {
  controller: ChatController; state: ChatState; active: boolean; terminal: TerminalPanelState;
}) {
  const connected = state.mode === 'direct' || state.mode === 'relay';
  const installer = useRemoteCliInstaller(controller.guiTools, active && connected);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState('');
  const running = state.sending || Boolean(state.selected?.turns?.some(turn => turn.status === 'inProgress'));
  const terminalLabel = terminal.open ? '收起远程终端' : '打开远程终端';
  const reconnect = async () => {
    if (reconnecting) return;
    if (!connected) { controller.connectNow(); return; }
    setReconnecting(true); setError('');
    try { await controller.guiTools.reconnect(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '未能重新连接远程 Codex，请稍后重试。'); }
    finally { setReconnecting(false); }
  };
  return <div className="gui-remote-tools">
    <Tooltip title="重新连接远程 Codex" styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" icon={<RefreshCw size={16} />} aria-label="重新连接远程 Codex"
        loading={reconnecting || state.connecting} disabled={running || installer.installing}
        onClick={() => { void reconnect(); }} />
    </Tooltip>
    <Popover trigger="click" placement="bottomRight" styles={{ root: { maxWidth: 400 } }} content={<>
      <Installer installer={installer} compact remote running={running} disabled={!connected} />
      {installer.error && <Alert type="error" message={installer.error} />}
    </>}>
      <Button type="text" icon={<Download size={16} />} aria-label="远程 Codex CLI 更新">
        {installer.version ? `v${installer.version}` : 'Codex'}</Button>
    </Popover>
    <Tooltip title={terminalLabel} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" icon={<PanelBottom size={16} />} aria-label={terminalLabel}
        aria-expanded={terminal.open} disabled={!connected && !terminal.open} onClick={terminal.toggle} />
    </Tooltip>
    {error && <Popover open content={<Alert type="error" message={error} closable onClose={() => setError('')} />}
      placement="bottomRight" styles={{ root: { maxWidth: 400 } }}><span /></Popover>}
  </div>;
}
