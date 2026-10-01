import { guiText } from "../../i18n/guiText";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { invoke } from "../../api/backend";
import type { AttachmentReference } from "./attachmentTypes";
import { ImagePreview } from "./ImagePreview";
import { isInlineImage } from "./imageSources";
import styles from "./ImageAttachments.module.less";

async function loadImage(path: string, variant: "thumbnail" | "original") {
  const { url } = await invoke<{ url: string }>("codex_gui_attachment_preview", { request: { path, variant } });
  if (!isInlineImage(url)) throw new Error(guiText("图片加载失败"));
  return url;
}

export function ComposerFileImage({ item, disabled, active, onRemove }: {
  item: AttachmentReference; disabled: boolean; active: boolean; onRemove: (path: string) => void;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUrl(undefined); setFailed(false);
    void loadImage(item.path, "thumbnail").then(
      (url) => { if (!cancelled) setUrl(url); },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, [item.path, attempt]);
  useEffect(() => { if (!active) setPreview(false); }, [active]);
  return <div className={styles.card}>
    {failed && <span className={styles.status} role="status">{guiText("图片加载失败")}<button type="button" onClick={() => setAttempt((value) => value + 1)}>{guiText("重试")}</button>
    </span>}
    {!failed && url && <button type="button" className={styles.thumbnail} aria-label={guiText("放大查看：{value1}", { value1: item.name })}
      onClick={() => setPreview(true)}>
      <img src={url} alt={item.name} onError={() => setFailed(true)} />
    </button>}
    {!failed && !url && <span role="status">{guiText("正在读取…")}</span>}
    <button type="button" className={styles.remove} disabled={disabled} aria-label={guiText("移除附件：{value1}", { value1: item.name })}
      onClick={() => onRemove(item.path)}><X size={14} /></button>
    {active && preview && url && <ImagePreview thumbnail={url} description={item.name}
      load={() => loadImage(item.path, "original")} close={() => setPreview(false)} />}
  </div>;
}
