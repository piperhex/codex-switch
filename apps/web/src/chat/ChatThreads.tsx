import { useState } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import type { ChatController, ChatState } from './types';

export function ChatThreads({ state, controller, newChat }: {
  state: ChatState; controller: ChatController; newChat: () => void;
}) {
  const [search, setSearch] = useState(state.search);
  const ready = state.mode === 'direct' || state.mode === 'relay';
  return <>
    <div className="chat-padded chat-thread-controls">
      <div className="chat-row"><h1 className="chat-grow">聊天</h1>
        <button className="chat-button" type="button" disabled={!ready} onClick={newChat}>
          <Plus size={16} />新聊天</button></div>
      <form className="chat-search chat-row" onSubmit={(event) => {
        event.preventDefault(); void controller.list({ search });
      }}>
        <input aria-label="搜索聊天" placeholder="搜索电脑上的聊天" value={search}
          onChange={(event) => setSearch(event.target.value)} />
        <button type="submit" className="chat-back" aria-label="搜索" disabled={!ready}><Search size={18} /></button>
      </form>
      <div className="chat-row">
        <button className="chat-button" type="button" disabled={!ready || state.loading}
          onClick={() => { void controller.list({ archived: !state.archived }); }}>
          {state.archived ? '已归档 ▾' : '最近聊天 ▾'}</button>
        <span className="chat-muted chat-grow">与电脑保持同步</span>
        <button className="chat-back" type="button" aria-label="刷新聊天" disabled={!ready || state.loading}
          onClick={() => { void controller.list(); }}><RefreshCw size={17} /></button>
      </div>
    </div>
    <div className="chat-scroll chat-padded chat-thread-list" aria-busy={state.loading}>
      {state.threads.map((thread) => <button type="button" className="chat-card" key={thread.id}
        disabled={!ready} onClick={() => { void controller.select(thread); }}>
        <strong className="chat-ellipsis">{thread.name || thread.preview || '新聊天'}</strong>
        <p className="chat-preview">{thread.preview}</p>
        <div className="chat-row chat-muted"><span className="chat-grow chat-ellipsis">
          {thread.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? '聊天'}</span>
          <time>{new Date(thread.updatedAt * 1000).toLocaleDateString('zh-CN')}</time></div>
      </button>)}
      {!state.threads.length && <div className="chat-empty">
        <h2>{ready ? '暂时没有聊天' : '正在连接你的电脑…'}</h2>
        <p className="chat-muted">{ready ? '创建新聊天，或换个关键词搜索。'
          : '请保持电脑上的 Codex Switch 运行，并登录同一账号。'}</p>
      </div>}
      {state.cursor && <button type="button" className="chat-button" disabled={!ready || state.loading}
        onClick={() => { void controller.list({ more: true }); }}>加载更多</button>}
    </div>
  </>;
}
