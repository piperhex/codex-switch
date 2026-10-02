import { t, useLanguage } from '../../i18n';
import type { Turn } from '../types';
import { useTaskReview } from '../../../../../shared/remote-chat/useTaskReview';
import { completedTurnFiles } from '../../../../../shared/chat/turnPresentation';
import { AdaptiveSheet } from '../../components/AdaptiveSheet';
import { ChatDiff } from '../ChatDiff';
import { TaskReviewChecks } from './TaskReviewChecks';
import { TaskReviewDelivery, TaskReviewRestore } from './TaskReviewDelivery';
import './review.css';

export function TaskReviewPanel({ turn }: { turn: Turn }) {
  useLanguage();
  const model = useTaskReview(turn);
  const comment = model.comment;
  return <div className="chat-review-panel">
    {!model.enabled && <p className="chat-review-notice">{t('连接电脑后可验证、提交意见和恢复修改。')}</p>}
    {model.error && <p role="alert" className="chat-error chat-review-notice">{t(model.error)}</p>}
    <button type="button" className="chat-text-action" disabled={model.loading || !model.enabled}
      onClick={() => { void model.refresh(); }}>{model.loading ? t('正在加载…') : t('刷新验收结果')}</button>
    <TaskReviewChecks model={model} />
    <section className="chat-review-section"><h3>{t('本轮改动')}</h3>
      <p className="chat-muted chat-review-notice">{t('点击改动行旁的留言按钮，让原会话继续修改。')}</p>
      {model.sent && <p role="status">{t('意见已发送到原会话。')}</p>}
      <ChatDiff files={completedTurnFiles(turn)} onComment={model.selectLine} />
    </section>
    <TaskReviewRestore model={model} />
    <TaskReviewDelivery model={model} turn={turn} />
    {comment && <AdaptiveSheet open title={t('修改意见')} width={400} onClose={model.closeComment}>
      <div className="chat-review-form">
        <p className="chat-review-path">{comment.file.path} · {t(comment.line.kind === 'remove' ? '修改前' : '修改后')}
          {' '}{comment.line.kind === 'remove' ? comment.line.oldLine : comment.line.newLine}</p>
        <pre className="chat-review-output">{comment.line.text}</pre>
        <textarea aria-label={t('修改意见')} placeholder={t('这行需要如何修改？')} value={model.feedback} rows={4}
          maxLength={8_000} onChange={event => model.setFeedback(event.target.value)} />
        <button type="button" className="chat-button" disabled={!model.enabled || model.busy || !model.feedback.trim()}
          onClick={() => { void model.sendComment(); }}>{t('发送到原会话')}</button>
        {model.error && <p role="alert" className="chat-error">{t(model.error)}</p>}
      </div>
    </AdaptiveSheet>}
  </div>;
}
