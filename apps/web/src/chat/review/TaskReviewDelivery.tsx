import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import type { TaskReviewModel } from '../../../../../shared/remote-chat/useTaskReview';
import { resultSummary } from '../../../../../shared/remote-chat/taskReview';
import type { Turn } from '../types';

export function TaskReviewDelivery({ model, turn }: { model: TaskReviewModel; turn: Turn }) {
  useLanguage();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(resultSummary(turn).slice(0, 80));
  const [body, setBody] = useState(resultSummary(turn));
  const [base, setBase] = useState('');
  const pr = model.pullRequest;
  const revision = model.snapshot?.revision;
  const current = !!revision && !revision.dirty && pr?.headRefOid === revision.head;
  return <section className="chat-review-section">
    <h3>{t('PR 与 CI')}</h3>
    <button type="button" className="chat-text-action" disabled={!model.enabled || model.busy}
      onClick={() => { void model.loadPr(); }}>{t('刷新 PR 与 CI')}</button>
    {model.prError && <p role="alert" className="chat-review-notice">{t(model.prError)}</p>}
    {pr && <>
      <p>{/^https:\/\//i.test(pr.url)
        ? <a href={pr.url} target="_blank" rel="noreferrer">#{pr.number} {pr.title}</a> : pr.title}</p>
      <p className="chat-muted">{t('PR 提交')}：{pr.headRefOid.slice(0, 10)}</p>
      {!current && <p className="chat-review-notice">{t('CI 对应其他代码版本，请提交并推送当前改动后再确认。')}</p>}
      {!pr.statusCheckRollup?.length && <p className="chat-muted">{t('暂无 CI 结果。')}</p>}
      {pr.statusCheckRollup?.map((check, index) => <p key={index}>
        {check.name || check.context || 'CI'}：{check.conclusion || check.state || check.status || t('待确认')}</p>)}
    </>}
    {model.prLoaded && !pr && <p className="chat-muted">{t('当前分支还没有打开的 PR。')}</p>}
    {!pr && <button type="button" className="chat-button" onClick={() => setCreating(!creating)}
      disabled={!model.enabled || model.busy || !revision || revision.dirty}>{t('创建草稿 PR')}</button>}
    {revision?.dirty && <p className="chat-review-notice chat-muted">{t('请先通过 Git 入口提交并推送当前改动，再创建 PR。')}</p>}
    {creating && !pr && <div className="chat-review-form">
      <label>{t('PR 标题')}<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
      <label>{t('目标分支（留空使用默认分支）')}<input value={base} maxLength={200}
        onChange={event => setBase(event.target.value)} /></label>
      <label>{t('PR 说明')}<textarea rows={5} value={body} maxLength={16_000}
        onChange={event => setBody(event.target.value)} /></label>
      <button type="button" className="chat-button"
        disabled={!title.trim() || model.busy || !model.enabled || !revision || revision.dirty}
        onClick={() => { void model.createPr({ title, body, base }); }}>{t('确认创建草稿 PR')}</button>
    </div>}
  </section>;
}

export function TaskReviewRestore({ model }: { model: TaskReviewModel }) {
  useLanguage();
  return <section className="chat-review-section">
    <h3>{t('恢复本轮修改')}</h3>
    <p className="chat-muted chat-review-notice">{t('恢复前检查新改动，发现冲突时不会覆盖文件。')}</p>
    {model.restored ? <p>{t('本轮修改已恢复。')}</p> : <button type="button" className="chat-text-action"
      disabled={!model.enabled || model.busy || model.running} onClick={() => { void model.previewRestore(); }}>
      {t('预览恢复影响')}</button>}
    {model.restore && <div className="chat-review-confirm">
      <p>{t(model.restore.conflict ? '文件已有其他修改，无法安全恢复。请先审核差异。'
        : '预览未发现冲突，恢复时会再次检查。')}</p>
      {model.restore.files.map(path => <p className="chat-review-path" key={path}>{path}</p>)}
      <button type="button" className="chat-button"
        disabled={model.restore.conflict || model.busy || model.running || !model.enabled}
        onClick={() => { void model.confirmRestore(); }}>{t('确认恢复本轮修改')}</button>
    </div>}
  </section>;
}
