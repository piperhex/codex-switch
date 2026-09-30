import { useState } from "react";
import { ImagePreview } from "./ImagePreview";
import styles from "./MessageImage.module.less";
import { useImageSource } from "./useImageSource";
import { isTauri } from "@tauri-apps/api/core";
import { isHostedWebApp } from "../../api/backend";
import { FileMenu } from "./FileMenu";
import { parseFileReference } from "./fileReference";

interface MessageImageProps { src?: string; alt?: string; title?: string }

export function MessageImage({ src, alt, title }: MessageImageProps) {
  const [failedSource, setFailedSource] = useState<string>();
  const [preview, setPreview] = useState(false);
  const image = useImageSource(src);
  const description = alt?.trim() || "图片";
  const file = src && (isTauri() || isHostedWebApp) ? parseFileReference(src) : undefined;
  if (file && (!image.url || image.failed || failedSource === image.url)) {
    return <FileMenu {...file} preview>{description}</FileMenu>;
  }
  if (image.loading) return <span className={styles.unavailable} role="status">正在加载{description}…</span>;
  if (image.failed || (image.url && failedSource === image.url)) return <span className={styles.unavailable} role="status">
    <span>{description}：图片加载失败</span>
    <button type="button" onClick={() => { setFailedSource(undefined); image.retry(); }}>重试</button>
  </span>;
  if (!image.url) return <span className={styles.unavailable}>{description}（暂不支持预览）</span>;

  if (file) return <FileMenu {...file} preview className={styles.thumbnail}>
    <img src={image.url} alt={description} title={title} loading="lazy" decoding="async"
      onError={() => setFailedSource(image.url)} />
  </FileMenu>;

  return <>
    <button type="button" className={styles.thumbnail} aria-label={`放大查看：${description}`}
      title={title} onClick={() => setPreview(true)}>
      <img src={image.url} alt={description} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        onError={() => setFailedSource(image.url)} />
    </button>
    {preview && <ImagePreview key={src} thumbnail={image.url} description={description}
      load={image.original} close={() => setPreview(false)} />}
  </>;
}
