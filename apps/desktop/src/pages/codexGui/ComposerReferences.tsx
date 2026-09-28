import { Blocks, File, Folder, MessageSquare, X } from "lucide-react";
import type { AttachmentReference } from "./attachmentTypes";
import { isDesktopApp } from "../../api/backend";
import { ComposerFileImage } from "./ComposerFileImage";
import imageStyles from "./ImageAttachments.module.less";
import styles from "./ComposerExtras.module.less";

function isImage(item: AttachmentReference) {
  return isDesktopApp && item.kind === "file" && /\.(png|jpe?g|webp|gif)$/i.test(item.path);
}

export function ComposerReferences({ items, disabled, active = true, onRemove }: {
  items: AttachmentReference[]; disabled: boolean; active?: boolean; onRemove: (path: string) => void;
}) {
  if (!items.length) return null;
  const images = items.filter(isImage);
  const references = items.filter((item) => !isImage(item));
  return <>
    {images.length > 0 && <div className={imageStyles.attachments} aria-label="本地图片附件">
      {images.map((item) => <ComposerFileImage key={item.path} item={item} disabled={disabled}
        active={active} onRemove={onRemove} />)}
    </div>}
    {references.length > 0 && <div className={styles.references} aria-label="文件、插件和对话引用">
      {references.map((item) => {
        const Icon = { plugin: Blocks, folder: Folder, file: File, conversation: MessageSquare }[item.kind];
        return <span className={styles.reference} key={item.path}>
          <Icon size={15} aria-hidden="true" /><span>{item.kind === "conversation" ? `@${item.name}` : item.name}</span>
          <button type="button" disabled={disabled} aria-label={`移除附件：${item.name}`}
            onClick={() => onRemove(item.path)}><X size={13} /></button>
        </span>;
      })}
    </div>}
  </>;
}
