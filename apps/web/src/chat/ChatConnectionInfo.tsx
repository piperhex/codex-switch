import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import type { ChatComputer } from '../../../../shared/remote-chat/devices';
import type { ChatState } from './types';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatProjectPicker } from './ChatProjectPicker';
import { ChatReconnectButton } from './ChatReconnectButton';

const modeLabels = { get connecting() { return t("正在连接…"); }, direct: 'P2P', relay: 'Relay', get offline() { return t("等待重新连接"); } };

export function ChatConnectionInfo({ state, controller, device, active, chooseDevice }: {
  state: ChatState; controller: ChatController; device?: ChatComputer; active: boolean; chooseDevice: () => void;
}) {
  useLanguage();
  const [picking, setPicking] = useState(false);
  const canChoose = active && state.ready && !state.selected && !state.sending;
  const canReconnect = active && device && !state.ready && !state.connecting && state.mode !== 'connecting';
  let status = modeLabels[state.mode];
  if (!state.ready && (state.mode === 'direct' || state.mode === 'relay')) status = t("正在同步聊天…");
  if (!state.ready && state.error) status = t("连接未完成");
  useEffect(() => { if (!canChoose) setPicking(false); }, [canChoose]);
  return <>
    <div className="chat-connection-info">
      <button className="chat-connection chat-muted chat-ellipsis" type="button" aria-label={t("选择电脑")}
        onClick={chooseDevice}>
        {device ? <>{device.name} · <span role="status">
          {status}</span></>
          : t("选择电脑，开始聊天")}
      </button>
      {canReconnect && <ChatReconnectButton retryAt={state.retryAt} onClick={controller.connectNow} />}
      {!state.selected && !canReconnect && <>
        <span className="chat-muted"> · </span>
        <button type="button" className="chat-connection chat-project-name chat-muted chat-ellipsis"
          aria-label={t("选择项目")} disabled={!canChoose} onClick={() => setPicking(true)}>
          {state.draftProject?.label || t("未选择项目")}</button>
      </>}
    </div>
    {picking && canChoose && <ChatProjectPicker cwd={state.draftProject?.cwd}
      load={controller.loadProjectDirectories} close={() => setPicking(false)}
      choose={(project) => { controller.chooseDraftProject(project); setPicking(false); }} />}
  </>;
}
