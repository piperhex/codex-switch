import { useState } from "react";
import { Modal } from "antd";
import styles from "./MessageImage.module.less";
import { useImageSource } from "./useImageSource";

interface MessageImageProps { src?: string; alt?: string; title?: string }

export function MessageImage({ src, alt, title }: MessageImageProps) {
  const [failedSource, setFailedSource] = useState<string>();
  const [preview, setPreview] = useState(false);
  const image = useImageSource(src);
  const description = alt?.trim() || "图片";
  if (image.loading) return <span className={styles.unavailable} role="status">正在加载{description}…</span>;
  if (image.failed || (image.url && failedSource === image.url)) return <span className={styles.unavailable} role="status">
    <span>{description}：图片加载失败</span>
    <button type="button" onClick={() => { setFailedSource(undefined); image.retry(); }}>重试</button>
  </span>;
  if (!image.url) return <span className={styles.unavailable}>{description}（暂不支持预览）</span>;

  return <>
    <button type="button" className={styles.thumbnail} aria-label={`放大查看：${description}`}
      title={title} onClick={() => setPreview(true)}>
      <img src={image.url} alt={description} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        onError={() => setFailedSource(image.url)} />
    </button>
    <Modal open={preview} title={description} footer={null} centered width="min(960px, 94vw)"
      onCancel={() => setPreview(false)} destroyOnClose>
      {preview && <img className={styles.preview} src={image.url} alt={description} referrerPolicy="no-referrer" />}
    </Modal>
  </>;
}
