import type { RefObject } from 'react';
import { X } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { conversationCandidates,
  conversationReference } from '../../../desktop/src/pages/codexGui/conversationReferences';
import type { AttachmentReference } from '../../../desktop/src/pages/codexGui/attachmentTypes';
import { useConversationCandidates, type ConversationSearch } from '../../../../shared/chat/useConversationCandidates';
import { useComposerMenuKeyboard } from './useComposerMenuKeyboard';

export function ComposerConversationMenu(props: {
  input: RefObject<HTMLTextAreaElement>; query: string; threadId: string | null; ready: boolean;
  load: ConversationSearch; choose: (reference: AttachmentReference) => void; close: () => void;
}) {
  useLanguage();
  const { input, query, threadId, ready, load, choose, close } = props;
  const result = useConversationCandidates({ active: true, connected: ready, query, load });
  const threads = conversationCandidates({ remote: result.threads, known: [], conversations: {},
    currentId: threadId, query });
  const keyboard = useComposerMenuKeyboard({ input, query, close, selectWithTab: true,
    options: threads.map(thread => ({ key: thread.id, enabled: ready,
      choose: () => choose(conversationReference(thread)) })) });
  return <div className="chat-command-menu chat-conversation-menu" aria-label={t('对话')}>
    <header><strong>{t('对话')}</strong><button type="button" aria-label={t('关闭对话列表')} onClick={close}>
      <X size={16} /></button></header>
    <div ref={keyboard.list} id={keyboard.id} className="chat-menu-options" role="menu" aria-label={t('对话')}>
      {threads.map(thread => <button key={thread.id} type="button" role="menuitem" disabled={!ready}
        {...keyboard.optionProps(thread.id)} onClick={() => choose(conversationReference(thread))}>
        <strong>{conversationReference(thread).name}</strong>
        <small>{thread.status?.type === 'active' ? t('运行中') : t('空闲')} · {thread.cwd || t('未选择项目')}</small>
      </button>)}
      {!ready && <p role="status">{t('连接后即可引用对话')}</p>}
      {ready && result.loading && !threads.length && <p role="status">{t('正在加载对话…')}</p>}
      {ready && result.error && <p role="status">{t(result.error)}</p>}
      {ready && !result.loading && !result.error && !threads.length && <p>{t('没有找到可引用的对话')}</p>}
    </div>
  </div>;
}
