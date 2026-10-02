import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { checkStatus, type CheckKind } from '../../../../../shared/remote-chat/taskReview';
import type { TaskReviewModel } from '../../../../../shared/remote-chat/useTaskReview';

const LABELS = { notRun: '未运行', running: '运行中', passed: '通过', failed: '失败',
  stale: '结果已过期', interrupted: '验证已中断' };

export function TaskReviewChecks({ model }: { model: TaskReviewModel }) {
  useLanguage();
  const [confirm, setConfirm] = useState<CheckKind | null>(null);
  const snapshot = model.snapshot;
  if (!snapshot) return null;
  const command = snapshot.commands.find(row => row.kind === confirm);
  return <section className="chat-review-section">
    <h3>{t('项目验证')}</h3>
    <p className="chat-muted chat-review-notice">{t('验证当前项目代码；聊天中提到的测试结果不会自动记为通过。')}</p>
    <p className="chat-muted">{t('代码版本')}：<code>{snapshot.revision.head?.slice(0, 8) || t('尚未提交')}
      {' / '}{snapshot.revision.id.slice(0, 10)}</code></p>
    {(['build', 'lint', 'test'] as const).map(kind => {
      const plan = snapshot.commands.find(row => row.kind === kind);
      const record = snapshot.checks.find(row => row.kind === kind);
      const status = checkStatus(record, snapshot.revision);
      return <div className="chat-review-check" key={kind}>
        <div className="chat-result-footer"><strong>{kind}</strong>
          <span data-check-status={status}>{t(LABELS[status])}</span>
          {plan && <button type="button" className="chat-text-action"
            disabled={!model.enabled || model.busy || model.running} onClick={() => setConfirm(kind)}>
            {t('运行验证')}</button>}</div>
        <small className="chat-muted">{plan?.command || t('项目未配置这项验证。')}</small>
        {record && <details><summary>{t('查看验证记录')}</summary>
          <p className="chat-muted">{t('代码版本')}：{record.revision.slice(0, 10)} · {record.command}
            {' · '}{new Date(record.startedAt).toLocaleString()}
            {record.exitCode != null && ` · exit ${record.exitCode}`}</p>
          <pre className="chat-review-output">{record.output || t('等待验证完成。')}</pre></details>}
      </div>;
    })}
    {command && <div className="chat-review-confirm" role="group" aria-label={t('确认运行验证')}>
      <p>{t('将在电脑上运行项目命令，可能修改文件或下载依赖。')}</p><code>{command.command}</code>
      <div className="chat-review-actions"><button type="button" className="chat-button"
        disabled={!model.enabled || model.busy || model.running}
        onClick={() => { setConfirm(null); void model.run(command.kind); }}>{t('确认运行验证')}</button>
        <button type="button" className="chat-text-action" onClick={() => setConfirm(null)}>{t('取消')}</button></div>
    </div>}
  </section>;
}
