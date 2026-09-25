import { useContext } from 'react';
import { FileText } from 'lucide-react';
import { DetailsContext } from '../../../desktop/src/pages/codexGui/detailsContext';
import type { DiffFile } from '../../../../shared/chat/diff';
import { t } from '../i18n';
import { ChatFilesSummary } from './ChatFilesSummary';
import { ChatChangesPill } from './ChatChangesPill';

const PREVIEW_FILES = 3;

export function ChatTurnFiles({ files, running, onOpen }: {
  files: DiffFile[]; running: boolean; onOpen: () => void;
}) {
  const details = useContext(DetailsContext);
  if (details) return <ChatFilesSummary files={files} compact={running} />;
  if (running) return <ChatChangesPill files={files} onOpen={onOpen} />;
  const paths = [...new Set(files.map(file => file.path))];
  return <div className="chat-files-summary">
    <button type="button" aria-label={t('查看本轮修改：{value1} 个文件', { value1: paths.length })} onClick={onOpen}>
      <FileText size={21} /><strong>{t('已编辑 {count} 个文件', { count: paths.length })}</strong>
      <b className="chat-added">+{files.reduce((sum, file) => sum + file.added, 0)}</b>
      <b className="chat-removed">−{files.reduce((sum, file) => sum + file.removed, 0)}</b><span>{t('审核')}</span>
    </button>
    {paths.slice(0, PREVIEW_FILES).map(path => <button key={path} type="button" onClick={onOpen}>
      <span className="chat-ellipsis">{path}</span></button>)}
    {paths.length > PREVIEW_FILES && <button type="button" onClick={onOpen}>
      {t('再显示 {count} 个文件', { count: paths.length - PREVIEW_FILES })}</button>}
  </div>;
}
