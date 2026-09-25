import { LoaderCircle, MoreHorizontal } from 'lucide-react';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import type { ChatState, Thread } from './types';
import { useThreadLongPress } from './useThreadLongPress';
import { t } from '../i18n';
import './thread-actions.css';

export function ChatThreadRow({ thread, state, select, openActions }: {
  thread: Thread; state: ChatState; select: () => void; openActions: () => void;
}) {
  const view = threadPresentation(thread, state.sidebar, t);
  const gestures = useThreadLongPress(openActions);
  const disabled = !state.ready || state.sending;
  return <div className="chat-thread-row">
    <button type="button" className="chat-thread" aria-label={view.title} {...gestures}
      aria-current={state.selected?.id === thread.id ? 'page' : undefined} disabled={disabled} onClick={select}>
      <span className="chat-grow chat-ellipsis">{view.title}</span>
      <span className="chat-thread-status">{view.running
        ? <LoaderCircle size={14} className="chat-spinner" aria-label={t('正在回复')} />
        : view.unread && <span className="chat-unread-dot" aria-label={t('未读回复')} />}</span>
    </button>
    <button type="button" className="chat-thread-more" aria-label={t('管理对话：{name}', { name: view.title })}
      aria-haspopup="dialog" disabled={disabled} onClick={openActions}><MoreHorizontal size={18} /></button>
  </div>;
}
