import { t, useLanguage } from '../../i18n';
import type { Turn } from '../types';
import { completedTurnFiles } from '../../../../../shared/chat/turnPresentation';
import { resultSummary } from '../../../../../shared/remote-chat/taskReview';
import { useTaskReviewContext } from '../../../../../shared/remote-chat/TaskReviewContext';
import './review.css';

export function TaskResultCard({ turn, open }: { turn: Turn; open: () => void }) {
  useLanguage();
  const context = useTaskReviewContext();
  const files = completedTurnFiles(turn);
  if (!context || !files.length || !['completed', 'failed', 'interrupted'].includes(turn.status)) return null;
  return <section className="chat-result-card">
    <strong>{t('任务验收')}</strong>
    <p className="chat-result-summary">{resultSummary(turn) || t('查看本轮改动，验证后再决定是否交付。')}</p>
    <div className="chat-result-footer"><span className="chat-muted">
      {t('{value1} 个改动文件', { value1: new Set(files.map(file => file.path)).size })}</span>
      <button type="button" className="chat-button" onClick={open}>{t('验收结果')}</button></div>
  </section>;
}
