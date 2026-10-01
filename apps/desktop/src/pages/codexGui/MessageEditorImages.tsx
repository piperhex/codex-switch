import { guiText } from "../../i18n/guiText";
import { X } from "lucide-react";
import type { Content } from "./types";
import { MessageImage } from "./MessageImage";
import styles from "./UserMessage.module.less";

export function MessageEditorImages({ images, removed, disabled, onRemove }: {
  images: Content[]; removed: number[]; disabled: boolean; onRemove: (index: number) => void;
}) {
  if (images.every((_, index) => removed.includes(index))) return null;
  return <div className={styles.editorImages}>
    {images.map((image, index) => removed.includes(index) ? null : <div className={styles.editorImage} key={index}>
      {image.url || image.path ? <MessageImage src={image.url || image.path} alt={guiText("图片附件 {value1}", { value1: index + 1 })} />
        : <span role="status">{guiText("正在读取图片…")}</span>}
      <button type="button" className={styles.removeImage} aria-label={guiText("移除图片 {value1}", { value1: index + 1 })}
        disabled={disabled} onClick={() => onRemove(index)}><X size={14} /></button>
    </div>)}
  </div>;
}
