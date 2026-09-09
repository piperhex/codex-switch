import { useState } from "react";
import { Button } from "antd";
import { Pencil } from "lucide-react";
import type { Content, Item } from "./types";
import { UserMessageEditor } from "./UserMessageEditor";
import { CopyButton } from "./CopyButton";
import { MessageImage } from "./MessageImage";
import userStyles from "./UserMessage.module.less";
import styles from "./styles.module.less";

const MILLISECONDS_PER_SECOND = 1000;
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function UserMessage({ item, startedAt, onEdit, editDisabled = false }: {
  item: Item; startedAt?: number | null; onEdit?: (text: string) => Promise<boolean>; editDisabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const parts = (item.content ?? []) as Content[];
  const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const date = startedAt == null ? null : new Date(startedAt * MILLISECONDS_PER_SECOND);
  const sentAt = date && Number.isFinite(date.getTime()) ? date : null;
  return <article className={styles.userMessage}>
    <div className={`${styles.userBubble} ${userStyles.bubble}`}>
      {parts.filter((part) => part.type === "localImage" || part.type === "image").map((part, index) =>
        part.url ? <MessageImage key={index} src={part.url} alt={`图片附件 ${index + 1}`} />
          : <span className={styles.imageLabel} key={index}>图片：{part.path?.split(/[\\/]/).pop() ?? "附件"}</span>)}
      {parts.filter((part) => part.type === "mention").map((part, index) =>
        <span className={styles.imageLabel} key={`reference-${index}`}>
          {part.path?.startsWith("plugin://") ? "插件" : "附件"}：{part.name || part.path}
        </span>)}
      {editing && onEdit ? <UserMessageEditor text={text} disabled={editDisabled} onSubmit={onEdit}
        onCancel={() => setEditing(false)} /> : <div>{text}</div>}
    </div>
    <div className={styles.userMessageActions}>
      {sentAt && <time dateTime={sentAt.toISOString()} title={sentAt.toLocaleString("zh-CN")}>
        {timeFormatter.format(sentAt)}
      </time>}
      <CopyButton text={text} />
      {onEdit && !editing && <Button type="text" size="small" aria-label="编辑消息" disabled={editDisabled}
        icon={<Pencil size={14} />} onClick={() => setEditing(true)} />}
    </div>
  </article>;
}
