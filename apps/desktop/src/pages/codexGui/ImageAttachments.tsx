import { useEffect, useState } from "react";
import { Modal } from "antd";
import { X } from "lucide-react";
import type { DraftImage } from "./useComposerDraft";
import styles from "./ImageAttachments.module.less";

export function ImageAttachments({ images, disabled, active = true, onRemove }: {
  images: DraftImage[]; disabled: boolean; active?: boolean; onRemove: (id: string) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = images.find((image) => image.id === previewId);
  useEffect(() => { if (!active || !preview) setPreviewId(null); }, [active, preview]);
  if (!images.length) return null;
  return <><div className={styles.attachments} aria-label="图片附件">
    {images.map((image, index) => <div className={styles.card} key={image.id}>
      {image.url ? <button type="button" className={styles.thumbnail} aria-label={`放大查看：图片 ${index + 1}`}
        onClick={() => setPreviewId(image.id)}>
        <img src={image.url} alt={`图片 ${index + 1}：${image.name}`} />
      </button>
        : <span role="status">正在读取…</span>}
      <button type="button" className={styles.remove} aria-label={`移除图片 ${index + 1}`}
        disabled={disabled} onClick={() => onRemove(image.id)}><X size={14} /></button>
    </div>)}
  </div>
    <Modal open={active && Boolean(preview?.url)} title="图片预览" footer={null} centered
      width="min(960px, 94vw)" onCancel={() => setPreviewId(null)} destroyOnClose>
      {preview?.url && <img className={styles.preview} src={preview.url} alt={preview.name} />}
    </Modal>
  </>;
}
