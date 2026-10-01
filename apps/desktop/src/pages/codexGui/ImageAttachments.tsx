import { guiText } from "../../i18n/guiText";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { DraftImage } from "./useComposerDraft";
import { ImagePreview } from "./ImagePreview";
import styles from "./ImageAttachments.module.less";

export function ImageAttachments({ images, disabled, active = true, onRemove }: {
  images: DraftImage[]; disabled: boolean; active?: boolean; onRemove: (id: string) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = images.find((image) => image.id === previewId);
  const previewUrl = preview?.url;
  useEffect(() => { if (!active || !preview) setPreviewId(null); }, [active, preview]);
  if (!images.length) return null;
  return <><div className={styles.attachments} aria-label={guiText("图片附件")}>
    {images.map((image, index) => <div className={styles.card} key={image.id}>
      {image.url ? <button type="button" className={styles.thumbnail} aria-label={guiText("放大查看：图片 {value1}", { value1: index + 1 })}
        onClick={() => setPreviewId(image.id)}>
        <img src={image.url} alt={guiText("图片 {value1}：{value2}", { value1: index + 1, value2: image.name })} />
      </button>
        : <span role="status">{guiText("正在读取…")}</span>}
      <button type="button" className={styles.remove} aria-label={guiText("移除图片 {value1}", { value1: index + 1 })}
        disabled={disabled} onClick={() => onRemove(image.id)}><X size={14} /></button>
    </div>)}
  </div>
    {active && preview && previewUrl && <ImagePreview key={preview.id} thumbnail={previewUrl} description={preview.name}
      load={async () => previewUrl}
      close={() => setPreviewId(null)} />}
  </>;
}
