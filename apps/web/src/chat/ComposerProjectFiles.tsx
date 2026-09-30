import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { ArrowLeft, File, Folder, RefreshCw } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { ProjectFile, ProjectFilesRequest, ProjectFilesResponse } from '../../../../shared/remote-chat/projectFiles';

export function ComposerProjectFiles({ threadId, cwd, imagesOnly, load, choose, close }: {
  threadId: string | null; cwd: string; imagesOnly: boolean;
  load: (options: ProjectFilesRequest) => Promise<ProjectFilesResponse>;
  choose: (file: ProjectFile) => void; close: () => void;
}) {
  useLanguage();
  const [directory, setDirectory] = useState<string>();
  const [result, setResult] = useState<ProjectFilesResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void load({ threadId: threadId ?? undefined, cwd, directory, imagesOnly })
      .then(value => { if (!cancelled) setResult(value); })
      .catch(() => { if (!cancelled) setError(t("暂时无法读取项目文件，请重试。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [threadId, cwd, directory, imagesOnly, load, attempt]);
  return <AdaptiveSheet open title={imagesOnly ? t("项目照片") : t("项目文件")} onClose={close} width={560}>
    <div className="chat-detail-stack">
      <div className="chat-row"><button type="button" className="chat-back" aria-label={t("上一级目录")}
        disabled={loading || !result?.parent} onClick={() => setDirectory(result?.parent ?? undefined)}>
        <ArrowLeft size={18} /></button><span className="chat-muted chat-grow">{result?.directory || cwd}</span>
        <button type="button" className="chat-back" aria-label={t("刷新文件")} disabled={loading}
          onClick={() => setAttempt(value => value + 1)}><RefreshCw size={18} /></button></div>
      {loading && <p role="status">{t("正在读取文件…")}</p>}
      {error && <p role="alert" className="chat-error">{t(error)}</p>}
      {!loading && !error && <div className="chat-project-file-list chat-scroll">
        {result?.entries.map(file => <button type="button" className="chat-thread" key={file.path}
          onClick={() => file.directory ? setDirectory(file.path) : choose(file)}>
          {file.directory ? <Folder size={18} /> : <File size={18} />}
          <span className="chat-grow chat-ellipsis">{file.name}</span></button>)}
        {!result?.entries.length && <p className="chat-muted">{t("此目录没有可选的")}{imagesOnly ? t("照片") : t("文件")}</p>}
        {result?.truncated && <p className="chat-muted">{t("文件较多，请进入具体目录查找。")}</p>}
      </div>}
    </div>
  </AdaptiveSheet>;
}
