import { Blocks, File, Folder, X } from "lucide-react";
import type { AttachmentReference } from "./attachmentTypes";
import styles from "./ComposerExtras.module.less";

export function ComposerReferences({ items, disabled, onRemove }: {
  items: AttachmentReference[]; disabled: boolean; onRemove: (path: string) => void;
}) {
  if (!items.length) return null;
  return <div className={styles.references} aria-label="文件和插件附件">
    {items.map((item) => {
      const Icon = item.kind === "plugin" ? Blocks : item.kind === "folder" ? Folder : File;
      return <span className={styles.reference} key={item.path}>
        <Icon size={15} aria-hidden="true" /><span>{item.name}</span>
        <button type="button" disabled={disabled} aria-label={`移除附件：${item.name}`}
          onClick={() => onRemove(item.path)}><X size={13} /></button>
      </span>;
    })}
  </div>;
}
