import { useEffect, useState } from 'react';
import { ArrowLeft, Monitor } from 'lucide-react';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApproval';
import { ChatComposer } from './ChatComposer';
import { ChatMessages } from './ChatMessages';
import { ChatThreads } from './ChatThreads';
import { useChat } from './useChat';
import './chat.css';

interface Props { session: AuthSession; devices: RemoteDevice[]; active: boolean }
const modeLabels = {
  connecting: '正在连接…', direct: '已直连', relay: '通过服务器连接', offline: '等待重新连接',
};

function useChatViewport(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--chat-height', `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty('--chat-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.style.removeProperty('--chat-height');
      root.style.removeProperty('--chat-top');
    };
  }, [active]);
}

export function ChatPage({ session, devices, active }: Props) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = devices.find((entry) => entry.deviceId === deviceId);
  useChatViewport(active);
  return <section className="chat-page" hidden={!active} aria-label="Codex 聊天">
    {device ? <ConnectedChat key={`${session.baseUrl}:${session.email}:${device.deviceId}`}
      session={session} device={device} active={active} disconnect={() => setDeviceId(null)} />
      : <div className="chat-scroll chat-padded chat-devices">
        <div><h1>聊天</h1><p className="chat-muted">把电脑上的对话带在身边</p></div>
        <div className="chat-hero"><h2>离开桌面，<br />也能接着聊。</h2>
          <p>连接你的电脑，查看历史、继续任务，实时收到回复。</p>
          <p>优先直接连接，网络受限时自动切换。</p></div>
        <h2>选择电脑</h2>
        {devices.map((entry) => <button type="button" key={entry.deviceId} className="chat-card chat-row"
          disabled={!entry.online} onClick={() => setDeviceId(entry.deviceId)}>
          <span className="chat-device-icon"><Monitor size={24} /></span>
          <span className="chat-grow"><strong>{entry.name}</strong><small>{entry.platform}</small></span>
          <span className="chat-pill">{entry.online ? '连接' : '离线'}</span>
        </button>)}
        {!devices.length && <div className="chat-card"><h2>还没有可连接的电脑</h2>
          <p className="chat-muted">在电脑上打开 Codex Switch 并登录同一账号，设备就会出现在这里。</p></div>}
        <p className="chat-muted chat-center">聊天内容在浏览器与电脑之间加密传输。</p>
      </div>}
  </section>;
}

function ConnectedChat({ session, device, active, disconnect }: {
  session: AuthSession; device: RemoteDevice; active: boolean; disconnect: () => void;
}) {
  const { state, controller } = useChat(session, device.deviceId, active);
  const [composing, setComposing] = useState(false);
  const showingChat = composing || !!state.selected;
  const ready = state.mode === 'direct' || state.mode === 'relay';
  const running = state.selected?.turns?.some((turn) => turn.status === 'inProgress') ?? false;
  const approvals = state.approvals.filter((event) => event.params.threadId === state.selected?.id);
  const back = () => {
    if (showingChat) { setComposing(false); controller.back(); }
    else disconnect();
  };
  return <>
    <header className="chat-header">
      <button type="button" className="chat-back" aria-label="返回" onClick={back}><ArrowLeft size={21} /></button>
      <div className="chat-grow"><h2>{state.selected?.name || device.name}</h2>
        <p className="chat-muted">{device.name} · <span role="status">{modeLabels[state.mode]}</span></p></div>
      {showingChat && state.selected && <button type="button" className="chat-button" disabled={!ready || running}
        onClick={() => { void controller.archive().then(() => setComposing(false)); }}>
        {state.archived ? '恢复' : '归档'}</button>}
    </header>
    {!!state.error && <p role="alert" className="chat-error">{state.error}</p>}
    {showingChat ? <>
      <ChatMessages key={state.selected?.id ?? 'new'} thread={state.selected} />
      {!!approvals.length && <div className="chat-approvals chat-scroll">
        {approvals.map((event) => <ChatApproval key={String(event.id)} event={event}
          ready={ready} respond={(reply) => controller.respond(reply)} />)}
      </div>}
      <ChatComposer models={state.models} active={active} ready={ready} sending={state.sending} running={running}
        send={(input) => controller.send(input)} interrupt={() => { void controller.interrupt(); }} />
    </> : <ChatThreads state={state} controller={controller} newChat={() => setComposing(true)} />}
  </>;
}
