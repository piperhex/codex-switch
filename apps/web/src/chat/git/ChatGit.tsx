import { Drawer, Spin } from 'antd';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';
import { useGitDiff, useRemoteGit, type RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { GitHistory } from './GitHistory';
import { useDesktopLayout } from '../../useDesktopLayout';
import { t } from '../../i18n';

interface Props {
  client: GitClient; cwd: string; connected: boolean; active: boolean; deviceName?: string; onClose: () => void;
}

export function ChatGit(props: Props) {
  const panel = useRemoteGit(props);
  const desktop = useDesktopLayout();
  const diff = useGitDiff(props.client, props.cwd, panel.detail, props.active && props.connected);
  return <Drawer open={props.active} title="Git" placement={desktop ? 'right' : 'bottom'}
    height="90%" width={desktop ? '80%' : undefined} onClose={props.onClose}
    rootClassName="chat-terminal-drawer chat-git-drawer" closable={{ 'aria-label': t('关闭 Git'), placement: 'end' }}
    extra={<span className="chat-terminal-device">{props.deviceName}</span>}>
    <div className="chat-git">
      <div className="git-toolbar"><span className="git-branch">{panel.changes?.branch ?? t('Git 仓库')}</span>
        <button type="button" aria-label={t('刷新 Git')} disabled={panel.busy || !props.connected || !props.cwd}
          onClick={() => { panel.setDetail(null); void panel.refresh(); }}><RefreshCw size={18} /></button></div>
      <div className="git-project" title={panel.changes?.root ?? props.cwd}>{panel.changes?.root ?? props.cwd}</div>
      {!props.cwd && <p className="git-notice">{t('请先选择一个项目。')}</p>}
      {!props.connected && <p className="git-notice">{t('电脑连接后即可使用 Git。')}</p>}
      {panel.error && <p role="alert" className="git-error">{t(panel.error)}</p>}
      {panel.changes?.files.some(file => file.conflict) && <p className="git-error">
        {t('请先在电脑上解决冲突或完成正在进行的合并。')}</p>}
      {panel.notice && <p role="status" className="git-notice">{t('已提交 {hash}', { hash: panel.notice })}</p>}
      {panel.detail ? <>
        <button type="button" className="git-detail-title" onClick={() => panel.setDetail(null)}>
          <ArrowLeft size={18} /><span>{panel.detail.title}</span></button>
        {diff.error && <p role="alert" className="git-error">{t(diff.error)}</p>}
        {!diff.value && !diff.error && props.connected && <Spin />}
        {diff.value && <div className="git-diff-scroll">
          {diff.value.truncated && <p className="git-notice">{t('差异较大，仅显示部分内容。')}</p>}
          <pre className="git-diff">{diff.value.text ? diff.value.text.split('\n').map((line, index) =>
            <span key={index} data-kind={line[0]}>{line}{'\n'}</span>) : t('没有可显示的文本差异。')}</pre>
        </div>}
      </> : <>
        <div className="git-tabs" role="tablist" aria-label={t('Git 视图')}>
          <button type="button" role="tab" aria-selected={panel.tab === 'changes'}
            onClick={() => panel.setTab('changes')}>
            {t('改动')} {panel.changes?.files.length ?? 0}</button>
          <button type="button" role="tab" aria-selected={panel.tab === 'history'}
            onClick={() => panel.setTab('history')}>
            {t('提交记录')}</button></div>
        {panel.busy && <div className="git-loading"><Spin size="small" />{t('正在处理…')}</div>}
        {panel.tab === 'changes' ? <GitChanges panel={panel} connected={props.connected} />
          : <GitHistory panel={panel} connected={props.connected} />}
      </>}
    </div>
  </Drawer>;
}

function GitChanges({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const files = panel.changes?.files ?? [];
  const count = Object.keys(panel.selected).length;
  const selectable = files.filter(file => !file.conflict);
  return <>
    <div className="git-selection"><label><input type="checkbox" disabled={panel.busy || !selectable.length}
      checked={!!selectable.length && count === selectable.length} onChange={panel.selectAll} />{t('全选')}</label>
      <span>{t('已选 {count} 个文件', { count })}</span></div>
    <div className="git-files">
      {panel.changes && !files.length && <p className="git-notice">{t('工作区没有未提交的改动。')}</p>}
      {files.map(file => <div key={file.path} className="git-file">
        <input type="checkbox" aria-label={t('选择 {path}', { path: file.path })} checked={!!panel.selected[file.path]}
          disabled={file.conflict || panel.busy} onChange={() => panel.toggle(file)} />
        <button type="button" disabled={!connected || panel.busy}
          onClick={() => panel.setDetail({ path: file.path, title: file.path })}>
          <span className="git-status" data-conflict={file.conflict}>
            {file.conflict ? t('冲突') : file.status.trim()}</span>
          <span>{file.path}{file.originalPath && <small>{file.originalPath} → {file.path}</small>}</span>
        </button></div>)}
    </div>
    <div className="git-commit-form"><textarea aria-label={t('提交说明')} placeholder={t('填写提交说明')}
      maxLength={4000} value={panel.message} disabled={panel.busy}
      onChange={event => panel.setMessage(event.target.value)} />
      <p>{t('提交所选文件的全部改动，包含已暂存和未暂存的内容。')}</p>
      <button type="button" className="git-submit" disabled={!panel.canCommit} onClick={() => void panel.commit()}>
        {t('提交 {count} 个文件', { count })}</button></div>
  </>;
}
