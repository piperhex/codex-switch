import { useEffect, useState } from 'react';
import { Drawer } from 'antd';
import { PanelLeft, X } from 'lucide-react';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApproval';
import { ChatComposer } from './ChatComposer';
import { ChatMessages } from './ChatMessages';
import { ChatProcessing } from './ChatProcessing';
import { ChatImageContext } from './ChatImage';
import { ChatThreads } from './ChatThreads';
import { ChatDevices } from './ChatDevices';
import { useChat } from './useChat';
import { useChatViewport } from './useChatViewport';
import './chat.css';

interface Props { session: AuthSession; devices: RemoteDevice[]; active: boolean }
const modeLabels = { connecting: '正在连接…', direct: '已直连', relay: '通过服务器连接', offline: '等待重新连接' };

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
  const newChat = () => { if (!state.sending) { controller.back(); setDrawer(false); } };
  useEffect(() => { controller.setViewing(active && !drawer && !pickingDevice); },
    [active, drawer, pickingDevice, controller]);
  useEffect(() => { if (!active) { setDrawer(false); setPickingDevice(false); } }, [active]);
  return <>
    <header className="chat-header">
      <button type="button" className="chat-back" aria-label="打开聊天列表" onClick={() => setDrawer(true)}>
        <PanelLeft size={21} /></button>
      <div className="chat-grow"><h2>{state.selected?.name || '新聊天'}</h2>
        <button className="chat-connection chat-muted" type="button" aria-label="选择电脑"
          onClick={() => setPickingDevice(true)}>
          {device ? <>{device.name} · <span role="status">
            {!ready && state.mode !== 'offline' ? '正在同步聊天…' : modeLabels[state.mode]}</span></>
            : '选择电脑，开始聊天'}
        </button></div>
      {state.selected && <button type="button" className="chat-button" disabled={!ready || running}
        onClick={() => { void controller.archive().then(() => setDrawer(true)); }}>
        {state.selectedArchived ? '恢复' : '归档'}</button>}
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
    <ChatComposer key={state.selected?.id ?? 'new'} models={state.models} selection={state.settings}
      settingsBusy={state.settingsBusy} settingsError={state.settingsError}
      updateSettings={(settings) => controller.setSettings(settings)}
      active={active} ready={ready} sending={state.sending} running={running}
      send={(input) => controller.send(input)} interrupt={() => { void controller.interrupt(); }} />
    <Drawer open={drawer} placement="left" width="min(360px, 88vw)" rootClassName="chat-drawer"
      title="聊天" destroyOnClose onClose={() => setDrawer(false)} closeIcon={<X size={20} aria-label="收起聊天列表" />}>
      <ChatThreads state={state} controller={controller} newChat={newChat} onClose={() => setDrawer(false)}
        deviceName={device?.name ?? '选择电脑'} chooseDevice={() => { setDrawer(false); setPickingDevice(true); }} />
    </Drawer>
    {pickingDevice && <ChatDevices devices={devices} onClose={() => setPickingDevice(false)}
      choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
  </>;
}
