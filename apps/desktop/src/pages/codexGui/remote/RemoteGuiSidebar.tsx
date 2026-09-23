import type { ReactNode } from 'react';
import { Button, Segmented } from 'antd';
import { ChevronRight, Folder, RefreshCw, Search, SquarePen } from 'lucide-react';
import type { ChatSidebarActions } from '../../../../../web/src/chat/ConnectedChat';
import type { ChatController, ChatState } from '../../../../../web/src/chat/types';
import { useThreadListScroll } from '../../../../../web/src/chat/useThreadListScroll';
import { useThreadGroups } from '../../../../../../shared/remote-chat/client/useThreadGroups';
import { threadPresentation } from '../../../../../../shared/remote-chat/sidebar';
import { FocusModeButton, type GuiFocusMode } from '../FocusModeButton';
import { ThreadStatus } from '../ThreadStatus';
import styles from '../styles.module.less';
import groupsStyle from '../ThreadGroup.module.less';
import navigationStyle from '../GuiNavigation.module.less';

export function RemoteGuiSidebar({ state, controller, actions, accountPicker, focusMode }: {
  state: ChatState; controller: ChatController; actions: ChatSidebarActions;
  accountPicker: ReactNode; focusMode: GuiFocusMode;
}) {
  const { groups, toggle, toggleCollapse } = useThreadGroups(state);
  const pagination = useThreadListScroll(state, controller);
  return <div className={`${styles.sidebar} gui-remote-sidebar`}>
    <div className={styles.sidebarHeading} data-tauri-drag-region>
      <h2 className={styles.sidebarTitle} data-tauri-drag-region>Codex GUI</h2>
      <div className={styles.sidebarActions}>
        <FocusModeButton {...focusMode} />
        <Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label="刷新对话"
          loading={state.loading} disabled={!state.ready} onClick={() => void controller.list()} />
        <Button type="text" size="small" icon={<Search size={15} />} aria-label="搜索对话"
          disabled={!state.ready} onClick={actions.openSearch} />
      </div>
    </div>
    <nav className={navigationStyle.navigation} aria-label="Codex GUI 导航">
      <button type="button" disabled={state.sending} onClick={() => actions.newChat()}>
        <SquarePen size={18} strokeWidth={1.6} /><span>新对话</span>
      </button>
    </nav>
    <Segmented className={styles.threadFilter} block size="small" value={state.archived ? 'archived' : 'recent'}
      options={[{ label: '最近', value: 'recent' }, { label: '已归档', value: 'archived' }]}
      disabled={!state.ready || state.loading}
      onChange={value => { void controller.list({ archived: value === 'archived' }); }} />
    <div ref={pagination.list} className={styles.threadList} aria-busy={state.loading}>
      {groups.map(group => <section className={groupsStyle.group} aria-label={group.label} key={group.cwd}>
        <div className={groupsStyle.header}>
          <button type="button" className={groupsStyle.heading} aria-expanded={!group.collapsed}
            onClick={() => toggleCollapse(group.cwd)}>
            <span className={groupsStyle.icon} aria-hidden="true">
              <Folder size={14} className={groupsStyle.folder} />
              <ChevronRight size={14} className={groupsStyle.arrow} />
            </span><span className={groupsStyle.label}>{group.label}</span>
          </button>
          {group.cwd && <button type="button" className={groupsStyle.add}
            aria-label={`在 ${group.label} 中新建对话`} disabled={state.sending}
            onClick={() => actions.newChat(group)}><SquarePen size={14} strokeWidth={1.6} /></button>}
        </div>
        <div className={groupsStyle.content} hidden={group.collapsed}>
          {group.data.map(thread => {
            const view = threadPresentation(thread, state.sidebar);
            const selected = state.selected?.id === thread.id;
            return <div key={thread.id} className={`${styles.thread} ${selected ? styles.selected : ''}`}>
              <button type="button" className={styles.threadSelect} aria-label={view.title}
                aria-current={selected ? 'page' : undefined} disabled={!state.ready || state.sending}
                onClick={() => { void controller.select(thread); actions.onClose(); }}>
                <span className={styles.threadTitle}>{view.title}</span>
                <ThreadStatus running={view.running} unread={view.unread}
                  needsInput={state.approvals.some(event => event.params.threadId === thread.id)} />
              </button>
            </div>;
          })}
          {group.canToggle && <button type="button" className={groupsStyle.more}
            aria-expanded={group.expanded} onClick={() => toggle(group.cwd)}>
            {group.expanded ? '收起' : '展开显示'}</button>}
        </div>
      </section>)}
      {!state.threads.length && <p className={styles.listEmpty}>{state.ready ? '还没有对话' : '连接电脑后查看对话'}</p>}
      <div ref={pagination.end} className="chat-thread-pagination">
        {pagination.loadingMore && <span role="status">正在加载…</span>}
        {state.cursor && pagination.failed && <Button disabled={!state.ready || state.loading}
          onClick={pagination.retry}>加载失败，点击重试</Button>}
      </div>
    </div>
    {accountPicker}
  </div>;
}
