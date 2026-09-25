import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { ThreadActionsModel } from '../../../../shared/remote-chat/client/useThreadActions';
import { THREAD_NAME_LIMIT } from '../../../../shared/remote-chat/client/threadActions';
import { t } from '../i18n';
import './thread-actions.css';

export function ChatThreadActions({ actions }: { actions: ThreadActionsModel }) {
  if (!actions.target) return null;
  const { view, name, busy, error, reason } = actions;
  const archive = actions.target.archived ? 'unarchive' : 'archive';
  const titles = { menu: t('操作 - {name}', { name: actions.target.title }),
    rename: t('重命名对话'), delete: t('删除这条对话？') };
  const hint = reason(view === 'menu' ? archive : view);
  return <AdaptiveSheet open title={titles[view]} truncateTitle width={400} onClose={actions.close}
    onBack={view !== 'menu' && !busy ? () => actions.changeView('menu') : undefined}>
    <div className="chat-thread-actions" aria-busy={busy}>
      {view === 'menu' && <>
        <button type="button" disabled={!!reason('rename')} onClick={() => actions.changeView('rename')}>
          <Pencil size={19} />{t('重命名对话')}</button>
        <button type="button" disabled={!!reason(archive)} onClick={() => void actions.submit(archive)}>
          {actions.target.archived ? <ArchiveRestore size={19} /> : <Archive size={19} />}
          {t(actions.target.archived ? '恢复' : '归档')}</button>
        <button type="button" className="chat-thread-danger" disabled={!!reason('delete')}
          onClick={() => actions.changeView('delete')}><Trash2 size={19} />{t('删除对话')}</button>
      </>}
      {view !== 'menu' && <form onSubmit={event => { event.preventDefault(); void actions.submit(view); }}>
        {view === 'rename' ? <input aria-label={t('对话名称')} autoFocus value={name} disabled={busy}
          maxLength={THREAD_NAME_LIMIT} onChange={event => actions.setName(event.target.value)}
          onFocus={event => event.target.select()} />
          : <p>{t('删除后可在电脑端“会话管理”的回收站中恢复。')}</p>}
        <div className="chat-thread-action-buttons">
          <button type="button" disabled={busy} onClick={actions.close}>{t('取消')}</button>
          <button type="submit" className={view === 'delete' ? 'chat-thread-danger' : ''}
            disabled={busy || !!hint || (view === 'rename' && !name.trim())}>
            {busy ? t('正在处理…') : t(view === 'rename' ? '保存' : '删除对话')}</button>
        </div>
      </form>}
      {!!(error || hint) && <p role="alert" className={error ? 'chat-error' : 'chat-muted'}>{t(error || hint)}</p>}
    </div>
  </AdaptiveSheet>;
}
