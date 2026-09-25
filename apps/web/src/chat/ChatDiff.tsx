import { t, useLanguage } from '../i18n';
import { useContext, useState } from 'react';
import { ChevronDown, FileText, Folder } from 'lucide-react';
import type { DiffFile } from '../../../../shared/chat/diff';
import { groupDiffFiles } from '../../../../shared/chat/diffGroups';
import { ChatCopyButton } from './ChatCopyButton';
import { DetailsContext } from '../../../desktop/src/pages/codexGui/detailsContext';
import { ChatFilesSummary } from './ChatFilesSummary';

const PAGE_LINES = 160;
function DiffContent({ file }: { file: DiffFile }) {
  useLanguage();
  const [limit, setLimit] = useState(PAGE_LINES);
  return <div className="chat-diff-content">
    <ChatCopyButton text={file.raw} label={t("复制差异")} />
    <pre tabIndex={0} onScroll={event => {
      const node = event.currentTarget;
      if (node.scrollHeight - node.scrollTop - node.clientHeight < 100) setLimit(value => value + PAGE_LINES);
    }}>{file.lines.slice(0, limit).map((line, index) =>
      <span className={`chat-diff-line ${line.kind}`} key={index}>
        <span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span>
        <code>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}{line.text}{'\n'}</code>
      </span>)}</pre>
    {limit < file.lines.length && <button type="button" className="chat-text-action"
      onClick={() => setLimit(value => value + PAGE_LINES)}>{t("显示更多差异")}</button>}
  </div>;
}

export function ChatDiff({ files, status }: { files: DiffFile[]; status?: string }) {
  useLanguage();
  const panel = useContext(DetailsContext);
  if (panel) return <ChatFilesSummary files={files} title="文件修改记录" status={status} />;
  return <div className="chat-diff">{groupDiffFiles(files).map(group =>
    <section key={group.directory}><h3><Folder size={17} />{group.name}</h3>
      <p className="chat-diff-folder">{group.directory || '.'}</p>
      {group.entries.map(({ file, index }) => <details key={index} className="chat-diff-file">
        <summary><FileText size={16} /><span title={file.path}>{file.path.split(/[\\/]/).at(-1)}</span>
          <b className="chat-added">+{file.added}</b><b className="chat-removed">−{file.removed}</b>
          <ChevronDown size={15} /></summary>
        {file.previousPath && <p className="chat-muted">{t("原路径：")}{file.previousPath}</p>}
        <DiffContent file={file} />
      </details>)}
    </section>)}</div>;
}
