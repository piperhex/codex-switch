import { useEffect, useState } from "react";
import { ConfigProvider, theme } from "antd";
import { MoreHorizontal } from "lucide-react";
import { useThemeMode } from "../../../hooks/useThemeMode";
import { FileMenu } from "../FileMenu";
import { CopyButton } from "../CopyButton";
import { filePreviewApi, type FilePreviewData } from "./api";
import { PreviewContent } from "./PreviewContent";
import styles from "./preview.module.less";

export function FilePreviewWindow() {
  const { mode } = useThemeMode();
  const [data, setData] = useState<FilePreviewData>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError("");
    void filePreviewApi.read().then(value => {
      if (!cancelled) { setData(value); setSource(Boolean(value.line)); }
    }).catch(() => { if (!cancelled) setError("文件未能加载，请重试。"); });
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => {
    document.documentElement.classList.add("file-preview-page");
    return () => document.documentElement.classList.remove("file-preview-page");
  }, []);
  return <ConfigProvider theme={{ algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <main className={styles.window}>
      <header className={styles.toolbar}>
        <div className={styles.heading}><strong>{data?.name ?? "文件预览"}</strong>
          <span>{data?.path}</span></div>
        {data && <>
          {(data.kind === "html" || data.kind === "markdown") && <div role="group" aria-label="显示方式"
            className={styles.modes}>
            <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>预览</button>
            <button type="button" aria-pressed={source} onClick={() => setSource(true)}>源码</button>
          </div>}
          {data.text !== null && <CopyButton text={data.text} label="复制文件内容" />}
          <FileMenu path={data.path} line={data.line} column={data.column} className={styles.menu}>
            <MoreHorizontal size={18} aria-hidden="true" /><span>文件菜单</span>
          </FileMenu>
        </>}
      </header>
      {data ? <PreviewContent data={data} source={source} />
        : <div className={styles.feedback} role="status">{error || "正在读取文件…"}
          {error && <button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button>}</div>}
    </main>
  </ConfigProvider>;
}
