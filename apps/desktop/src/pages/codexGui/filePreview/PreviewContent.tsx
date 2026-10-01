import { guiText } from "../../../i18n/guiText";
import { useState } from "react";
import type { FilePreviewData } from "./api";
import { PreviewCode } from "./PreviewCode";
import { PreviewMarkdown } from "./PreviewMarkdown";
import styles from "./preview.module.less";

function MediaPreview({ data }: { data: FilePreviewData }) {
  const [failed, setFailed] = useState(false);
  const [originalSize, setOriginalSize] = useState(false);
  if (failed) return <p className={styles.feedback} role="status">
    {guiText("暂时无法预览此文件，请使用右上角的文件菜单选择其他打开方式。")}</p>;
  const onError = () => setFailed(true);
  if (data.kind === "pdf") return <object className={styles.frame} data={data.url} type="application/pdf">
    <p className={styles.feedback}>{guiText("此 PDF 暂时无法预览，请使用右上角的文件菜单打开。")}</p>
  </object>;
  if (data.kind === "image") return <div className={styles.imageArea}>
    <button type="button" className={styles.imageToggle} onClick={() => setOriginalSize(!originalSize)}>
      {originalSize ? guiText("适应窗口") : guiText("原始大小")}
    </button>
    <div className={originalSize ? styles.originalImage : styles.fittedImage}>
      <img src={data.url} alt={data.name} onError={onError} />
    </div>
  </div>;
  return <div className={styles.media}>
    {data.kind === "video" ? <video aria-label={data.name} controls playsInline preload="metadata"
      src={data.url} onError={onError} />
      : <audio aria-label={data.name} controls preload="metadata" src={data.url} onError={onError} />}
  </div>;
}

export function PreviewContent({ data, source }: { data: FilePreviewData; source: boolean }) {
  if (data.text !== null && (source || data.kind === "text")) {
    return <PreviewCode text={data.text} path={data.path} line={data.line} />;
  }
  if (data.kind === "html") return <iframe title={guiText("HTML 预览")} className={styles.frame}
    src={data.url} sandbox="allow-scripts" referrerPolicy="no-referrer" />;
  if (data.kind === "markdown") return <PreviewMarkdown text={data.text ?? ""} path={data.path} url={data.url} />;
  return <MediaPreview key={data.url} data={data} />;
}
