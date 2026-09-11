import { useEffect, useState } from 'react';
import type { RemoteDevice } from '../types';
import type { ChatState } from './types';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatProjectPicker } from './ChatProjectPicker';

const modeLabels = { connecting: '正在连接…', direct: 'P2P', relay: 'Relay', offline: '等待重新连接' };

export function ChatConnectionInfo({ state, controller, device, active, chooseDevice }: {
  state: ChatState; controller: ChatController; device?: RemoteDevice; active: boolean; chooseDevice: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const canChoose = active && state.ready && !state.selected && !state.sending;
  useEffect(() => { if (!canChoose) setPicking(false); }, [canChoose]);
  return <>
    <div className="chat-connection-info">
      <button className="chat-connection chat-muted chat-ellipsis" type="button" aria-label="选择电脑"
        onClick={chooseDevice}>
        {device ? <>{device.name} · <span role="status">
          {!state.ready && state.mode !== 'offline' ? '正在同步聊天…' : modeLabels[state.mode]}</span></>
          : '选择电脑，开始聊天'}
      </button>
      {!state.selected && <>
        <span className="chat-muted"> · </span>
        <button type="button" className="chat-connection chat-project-name chat-muted chat-ellipsis"
          aria-label="选择项目" disabled={!canChoose} onClick={() => setPicking(true)}>
          {state.draftProject?.label || '未选择项目'}</button>
      </>}
    </div>
    {picking && canChoose && <ChatProjectPicker cwd={state.draftProject?.cwd}
      load={controller.loadProjectDirectories} close={() => setPicking(false)}
      choose={(project) => { controller.chooseDraftProject(project); setPicking(false); }} />}
  </>;
}
