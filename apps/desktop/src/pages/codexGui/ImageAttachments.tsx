import { X } from "lucide-react";
import type { DraftImage } from "./useComposerDraft";
import styles from "./ImageAttachments.module.less";

export function ImageAttachments({ images, disabled, onRemove }: {
  images: DraftImage[]; disabled: boolean; onRemove: (id: string) => void;
}) {
  if (!images.length) return null;
  return <div className={styles.attachments} aria-label="图片附件">
    {images.map((image, index) => <div className={styles.card} key={image.id}>
      {image.url ? <img src={image.url} alt={`图片 ${index + 1}：${image.name}`} />
        : <span role="status">正在读取…</span>}
      <button type="button" className={styles.remove} aria-label={`移除图片 ${index + 1}`}
        disabled={disabled} onClick={() => onRemove(image.id)}><X size={14} /></button>
    </div>)}
  </div>;
}
