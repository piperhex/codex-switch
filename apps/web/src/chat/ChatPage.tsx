import { useEffect, useState } from 'react';
import { Drawer } from 'antd';
import { PanelLeft, X } from 'lucide-react';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApproval';
import { ChatComposer } from './ChatComposer';
import { ChatQueue } from './ChatQueue';
import { queueProps } from '../../../../shared/remote-chat/client/queueProps';
import { ChatMessages } from './ChatMessages';
import { ChatProcessing } from './ChatProcessing';
import { ChatImageContext } from './ChatImage';
import { ChatThreads } from './ChatThreads';
import { ChatDevices } from './ChatDevices';
import { ChatConnectionInfo } from './ChatConnectionInfo';
import { useChat } from './useChat';
import { useChatViewport } from './useChatViewport';
import type { ChatProject } from './types';
import './chat.css';

interface Props { session: AuthSession; devices: RemoteDevice[]; active: boolean }

export function ChatPage({ session, devices, active }: Props) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = devices.find((entry) => entry.deviceId === deviceId)
    ?? devices.find((entry) => entry.online) ?? devices[0];
  useEffect(() => { if (!deviceId && device) setDeviceId(device.deviceId); }, [deviceId, device?.deviceId]);
  useChatViewport(active);
  return <section className="chat-page" hidden={!active} aria-label="Codex 聊天">
    <ConnectedChat key={`${session.baseUrl}:${session.email}:${device?.deviceId ?? ''}`} session={session}
      device={device} devices={devices} active={active} chooseDevice={setDeviceId} />
  </section>;
}

function ConnectedChat({ session, device, devices, active, chooseDevice }: Props & {
  device?: RemoteDevice; chooseDevice: (id: string) => void;
}) {
  const { state, controller } = useChat(session, device?.deviceId ?? '', active && Boolean(device));
  const [drawer, setDrawer] = useState(false);
  const [pickingDevice, setPickingDevice] = useState(false);
  const ready = state.ready;
  const runningTurn = state.selected?.turns?.find((turn) => turn.status === 'inProgress');
  const running = Boolean(runningTurn);
  const approvals = state.approvals.filter((event) => event.params.threadId === state.selected?.id);
  const newChat = (project?: ChatProject) => { if (!state.sending) { controller.back(project); setDrawer(false); } };
  useEffect(() => { controller.setViewing(active && !drawer && !pickingDevice); },
    [active, drawer, pickingDevice, controller]);
  useEffect(() => { if (!active) { setDrawer(false); setPickingDevice(false); } }, [active]);
  return <>
    <header className="chat-header">
      <button type="button" className="chat-back" aria-label="打开聊天列表" onClick={() => setDrawer(true)}>
        <PanelLeft size={21} /></button>
      <div className="chat-grow"><h2>{state.selected?.name || '新聊天'}</h2>
        <ChatConnectionInfo state={state} controller={controller} device={device} active={active}
          chooseDevice={() => setPickingDevice(true)} /></div>
      {state.selected && state.selectedArchived && <button type="button" className="chat-button"
        disabled={!ready || running}
        onClick={() => { void controller.archive().then(() => setDrawer(true)); }}>
        恢复</button>}
    </header>
    {!!state.error && <p role="alert" className="chat-error">{state.error}</p>}
    <ChatImageContext.Provider value={{ threadId: state.selected?.id ?? null, ready, load: controller.imagePreview }}>
      <ChatMessages key={state.selected?.id ?? 'new'} thread={state.selected}
        loading={state.historyLoading} loadingMore={state.historyLoadingMore} hasMore={state.historyHasMore}
        loadOlder={() => controller.loadOlder()} />
    </ChatImageContext.Provider>
    {runningTurn && <ChatProcessing key={runningTurn.id} turn={runningTurn} active={active && ready} />}
    {!!approvals.length && <div className="chat-approvals chat-scroll">
      {approvals.map((event) => <ChatApproval key={String(event.id)} event={event}
        ready={ready} respond={(reply) => controller.respond(reply)} />)}
    </div>}
    <ChatQueue {...queueProps(state, controller)} />
    <ChatComposer threadId={state.selected?.id ?? null} models={state.models} selection={state.settings}
      settingsBusy={state.settingsBusy} settingsError={state.settingsError}
      updateSettings={(settings) => controller.setSettings(settings)}
      active={active} ready={ready} sending={state.sending} running={running}
      interrupted={state.selected?.turns?.at(-1)?.status === 'interrupted'}
      send={(input) => controller.send(input)} interrupt={() => controller.interrupt()} />
    <Drawer open={drawer} placement="left" width="min(360px, 88vw)" rootClassName="chat-drawer"
      title="聊天" destroyOnClose onClose={() => setDrawer(false)} closeIcon={<X size={20} aria-label="收起聊天列表" />}>
      <ChatThreads state={state} controller={controller} newChat={newChat} onClose={() => setDrawer(false)}
        deviceName={device?.name ?? '选择电脑'} chooseDevice={() => { setDrawer(false); setPickingDevice(true); }} />
    </Drawer>
    {pickingDevice && <ChatDevices devices={devices} onClose={() => setPickingDevice(false)}
      choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
  </>;
}
