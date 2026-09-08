import { useState } from "react";
import { Modal } from "antd";
import styles from "./MessageImage.module.less";

interface MessageImageProps { src?: string; alt?: string; title?: string }

export function MessageImage({ src, alt, title }: MessageImageProps) {
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const description = alt?.trim() || "图片";
  // Only load explicit web images; relative paths must not invoke local application endpoints.
  if (!src || !/^https?:\/\//i.test(src)) {
    return <span className={styles.unavailable}>{description}（暂不支持预览）</span>;
  }
  if (failed) return <span className={styles.unavailable} role="status">
    <span>{description}：图片加载失败</span>
    <button type="button" onClick={() => setFailed(false)}>重试</button>
  </span>;

  return <>
    <button type="button" className={styles.thumbnail} aria-label={`放大查看：${description}`}
      title={title} onClick={() => setPreview(true)}>
      <img src={src} alt={description} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        onError={() => setFailed(true)} />
    </button>
    <Modal open={preview} title={description} footer={null} centered width="min(960px, 94vw)"
      onCancel={() => setPreview(false)} destroyOnClose>
      {preview && <img className={styles.preview} src={src} alt={description} referrerPolicy="no-referrer" />}
    </Modal>
  </>;
}
