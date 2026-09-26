import { Drawer, Spin } from 'antd';
import { ArrowLeft } from 'lucide-react';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';
import { useGitDiff, useRemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { useGitCommitFiles } from '../../../../../shared/remote-chat/useGitCommitFiles';
import { GitHistory } from './GitHistory';
import { GitChanges } from './GitChanges';
import { GitCommitFiles } from './GitCommitFiles';
import { GitToolbar } from './GitToolbar';
import { useDesktopLayout } from '../../useDesktopLayout';
import { t } from '../../i18n';

interface Props {
  client: GitClient; cwd: string; connected: boolean; active: boolean; deviceName?: string; onClose: () => void;
}

export function ChatGit(props: Props) {
  const panel = useRemoteGit(props);
  const detail = panel.detail;
  const commitFiles = useGitCommitFiles(props.client, props.cwd, detail?.commit?.hash, props.active && props.connected);
  const desktop = useDesktopLayout();
  const diff = useGitDiff(props.client, props.cwd, panel.detail, props.active && props.connected);
  return <Drawer open={props.active} title="Git" placement={desktop ? 'right' : 'bottom'}
    height="90%" width={desktop ? '80%' : undefined} onClose={props.onClose}
    rootClassName="chat-terminal-drawer chat-git-drawer" closable={{ 'aria-label': t('关闭 Git'), placement: 'end' }}
    extra={<span className="chat-terminal-device">{props.deviceName}</span>}>
    <div className="chat-git">
      <GitToolbar panel={panel} connected={props.connected} />
      <div className="git-project" title={panel.changes?.root ?? props.cwd}>{panel.changes?.root ?? props.cwd}</div>
      {!props.cwd && <p className="git-notice">{t('请先选择一个项目。')}</p>}
      {!props.connected && <p className="git-notice">{t('电脑连接后即可使用 Git。')}</p>}
      {panel.error && <p role="alert" className="git-error">{t(panel.error)}</p>}
      {panel.changes?.files.some(file => file.conflict) && <p className="git-error">
        {t('请先在电脑上解决冲突或完成正在进行的合并。')}</p>}
      {panel.notice && <p role="status" className="git-notice">{panel.notice.startsWith('已提交 ')
        ? t('已提交 {hash}', { hash: panel.notice.slice(4) }) : t(panel.notice)}</p>}
      {panel.busy && <div className="git-loading"><Spin size="small" />{t('正在处理…')}</div>}
      {detail?.kind === 'files' && <GitCommitFiles commit={detail.commit} state={commitFiles}
        connected={props.connected} onBack={panel.backDetail}
        onSelect={file => panel.setDetail({ kind: 'diff', path: file.path, commit: detail.commit,
          title: `${file.path} · ${detail.commit.hash.slice(0, 8)}` })} />}
      {detail?.kind === 'diff' && <>
        <button type="button" className="git-detail-title" onClick={panel.backDetail}
          aria-label={detail.commit ? t('返回文件列表') : undefined}>
          <ArrowLeft size={18} /><span>{detail.title}</span></button>
        {diff.error && <p role="alert" className="git-error">{t(diff.error)}</p>}
        {!diff.value && !diff.error && props.connected && <Spin />}
        {diff.value && <div className="git-diff-scroll">
          {diff.value.truncated && <p className="git-notice">{t('差异较大，仅显示部分内容。')}</p>}
          <pre className="git-diff">{diff.value.text ? diff.value.text.split('\n').map((line, index) =>
            <span key={index} data-kind={line[0]}>{line}{'\n'}</span>) : t('没有可显示的文本差异。')}</pre>
        </div>}
      </>}
      {!detail && <>
        <div className="git-tabs" role="tablist" aria-label={t('Git 视图')}>
          <button type="button" role="tab" aria-selected={panel.tab === 'changes'}
            onClick={() => panel.setTab('changes')}>
            {t('改动')} {panel.changes?.files.length ?? 0}</button>
          <button type="button" role="tab" aria-selected={panel.tab === 'history'}
            onClick={() => panel.setTab('history')}>
            {t('提交记录')}</button></div>
        {panel.tab === 'changes' ? <GitChanges panel={panel} connected={props.connected} />
          : <GitHistory panel={panel} connected={props.connected} />}
      </>}
    </div>
  </Drawer>;
}
