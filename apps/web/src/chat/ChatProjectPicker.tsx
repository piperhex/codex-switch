import { Folder, ChevronRight } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { directoryProject, type ProjectPickerProps } from '../../../../shared/remote-chat/projectDirectories';
import { useProjectDirectories } from '../../../../shared/remote-chat/client/useProjectDirectories';

export function ChatProjectPicker(props: ProjectPickerProps) {
  const { result, loading, error, browse, retry } = useProjectDirectories(props);
  return <AdaptiveSheet open title="选择项目" width={400} onClose={props.close}>
    <div className="chat-settings chat-project-picker">
      <p className="chat-muted chat-project-path">{result?.directory || '此电脑'}</p>
      <div className="chat-row">
        <button type="button" className="chat-button" disabled={loading} onClick={() => browse('')}>此电脑</button>
        {result?.parent != null && <button type="button" className="chat-button" disabled={loading}
          onClick={() => browse(result.parent ?? '')}>返回上一级</button>}
      </div>
      {loading && <p role="status" className="chat-muted">正在读取文件夹…</p>}
      {!!error && <div><p role="alert" className="chat-error">{error}</p>
        <button type="button" className="chat-button" onClick={retry}>重试</button></div>}
      <div className="chat-project-folders chat-scroll">
        {result?.entries.map((entry) => <button type="button" key={entry.path} className="chat-thread"
          aria-label={entry.name} disabled={loading} onClick={() => browse(entry.path)}>
          <Folder size={21} /><span className="chat-grow chat-ellipsis">{entry.name}</span><ChevronRight size={18} />
        </button>)}
        {!loading && !error && !result?.entries.length && <p className="chat-muted">此处没有子文件夹</p>}
        {result?.truncated && <p className="chat-muted">文件夹较多，仅显示部分结果。</p>}
      </div>
      <button type="button" className="chat-button chat-primary" disabled={loading || !result?.directory}
        onClick={() => { if (result?.directory) props.choose(directoryProject(result.directory)); }}>选择此文件夹</button>
    </div>
  </AdaptiveSheet>;
}
