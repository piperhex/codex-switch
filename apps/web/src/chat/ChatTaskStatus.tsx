import { taskIssue } from '../../../../shared/remote-chat/taskStatus';
import { t, useLanguage } from '../i18n';
import type { ChatState } from './types';

export function ChatTaskStatus({ state }: { state: ChatState }) {
  useLanguage();
  const status = taskIssue(state);
  if (!status && !state.notificationError) return null;
  return <div role="status" className="chat-task-status" style={{ padding: '6px 16px', fontSize: 12 }}>
    {status && <div style={{ maxWidth: 400, overflowWrap: 'anywhere' }}>
      <strong>{t(status.label)}</strong><div className="chat-muted">{t(status.detail)}</div>
    </div>}
    {state.notificationError && <div role="alert" style={{ maxWidth: 400 }}>
      {t('部分提醒未能保存，请检查电脑可用空间，并在聊天中核对任务进度。')}</div>}
  </div>;
}
