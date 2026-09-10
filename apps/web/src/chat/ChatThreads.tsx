import { useState } from 'react';
import { LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import type { ChatController, ChatState } from './types';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { useThreadGroups } from '../../../../shared/remote-chat/client/useThreadGroups';

interface Props {
  state: ChatState; controller: ChatController; newChat: () => void; onClose: () => void;
  chooseDevice: () => void; deviceName: string;
}

export function ChatThreads({ state, controller, newChat, onClose, chooseDevice, deviceName }: Props) {
  const [search, setSearch] = useState(state.search);
  const { groups, toggle } = useThreadGroups(state);
  const ready = state.ready;
  return <>
    <div className="chat-padded chat-thread-controls">
      <button className="chat-button" type="button" disabled={state.sending} onClick={newChat}>
        <Plus size={16} />新聊天</button>
      <form className="chat-search chat-row" onSubmit={(event) => {
        event.preventDefault(); void controller.list({ search });
      }}>
        <input aria-label="搜索聊天" placeholder="搜索聊天" value={search}
          onChange={(event) => setSearch(event.target.value)} />
        <button type="submit" className="chat-back" aria-label="搜索" disabled={!ready}><Search size={18} /></button>
      </form>
      <div className="chat-row">
        <button className="chat-button chat-grow" type="button" disabled={!ready || state.loading}
          onClick={() => { void controller.list({ archived: !state.archived }); }}>
          {state.archived ? '已归档 ▾' : '最近聊天 ▾'}</button>
        <button className="chat-back" type="button" aria-label="刷新聊天" disabled={!ready || state.loading}
          onClick={() => { void controller.list(); }}><RefreshCw size={17} /></button>
      </div>
    </div>
    <div className="chat-scroll chat-thread-list" aria-busy={state.loading}>
      {groups.map((group) =>
        <section className="chat-project-group" aria-label={group.label} key={group.cwd}>
          <h3>{group.label}</h3>
          {group.data.map((thread) => {
            const view = threadPresentation(thread, state.sidebar);
            return <button type="button" className="chat-thread" key={thread.id} aria-label={view.title}
              aria-current={state.selected?.id === thread.id ? 'page' : undefined} disabled={!ready || state.sending}
              onClick={() => { void controller.select(thread); onClose(); }}>
              <span className="chat-grow chat-ellipsis">{view.title}</span>
              <span className="chat-thread-status">{view.running
                ? <LoaderCircle size={14} className="chat-spinner" aria-label="正在回复" />
                : view.unread && <span className="chat-unread-dot" aria-label="未读回复" />}</span>
            </button>;
          })}
          {group.canToggle && <button type="button" className="chat-group-more" aria-expanded={group.expanded}
            aria-label={`${group.expanded ? '收起' : '展开显示'}：${group.label}`} onClick={() => toggle(group.cwd)}>
            {group.expanded ? '收起' : '展开显示'}</button>}
        </section>)}
      {!state.threads.length && <p className="chat-empty chat-muted">
        {ready ? '暂时没有聊天' : '连接电脑后查看聊天'}</p>}
      {state.cursor && <button type="button" className="chat-button" disabled={!ready || state.loading}
        onClick={() => { void controller.list({ more: true }); }}>加载更多</button>}
    </div>
    <button type="button" className="chat-device-switch chat-muted" aria-label="切换电脑" onClick={chooseDevice}>
      {deviceName} ›</button>
  </>;
}
