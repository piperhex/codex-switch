import { ChevronRight, FileText } from 'lucide-react';
import type { DiffFile } from '../../../../shared/chat/diff';
import { t } from '../i18n';

export function ChatChangesPill({ files, onOpen }: { files: DiffFile[]; onOpen: () => void }) {
  const count = new Set(files.map(file => file.path)).size;
  return <button type="button" className="chat-changes-pill"
    aria-label={t('查看本轮修改：{value1} 个文件', { value1: count })} onClick={onOpen}>
    <FileText size={15} /><span>{t('已编辑 {count} 个文件', { count })}</span>
    <span className="chat-added">+{files.reduce((sum, file) => sum + file.added, 0)}</span>
    <span className="chat-removed">−{files.reduce((sum, file) => sum + file.removed, 0)}</span>
    <ChevronRight size={14} />
  </button>;
}
