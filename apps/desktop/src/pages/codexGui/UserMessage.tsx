import { useState } from "react";
import { Button } from "antd";
import { Pencil } from "lucide-react";
import type { Content, Item } from "./types";
import { UserMessageEditor } from "./UserMessageEditor";
import { CopyButton } from "./CopyButton";
import { MessageImage } from "./MessageImage";
import { MessageQuotes } from "./MessageQuotes";
import { quotedMessage } from "../../../../../shared/chat/quotedMessage";
import { FileMenu } from "./FileMenu";
import { isFileReference } from "./fileReference";
import { CONVERSATION_PREFIX } from "./conversationReferences";
import { isMessageImage, type SubmitMessageEdit } from "./messageEditContent";
import userStyles from "./UserMessage.module.less";
import styles from "./styles.module.less";

const MILLISECONDS_PER_SECOND = 1000;
const sentAtFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function UserMessage({ item, startedAt, onEdit, editDisabled = false }: {
  item: Item; startedAt?: number | null; onEdit?: SubmitMessageEdit; editDisabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const parts = (item.content ?? []) as Content[];
  const images = parts.filter(isMessageImage);
  const mentions = parts.filter((part) => part.type === "mention");
  const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const message = quotedMessage(text);
  const date = startedAt == null ? null : new Date(startedAt * MILLISECONDS_PER_SECOND);
  const sentAt = date && Number.isFinite(date.getTime()) ? date : null;
  const showBubble = editing || Boolean(message.text || message.quotes.length || mentions.length);
  return <article className={`${styles.userMessage} ${editing ? userStyles.editingMessage : ""}`}>
    {!editing && images.length > 0 && <div className={userStyles.attachments}>
      {images.map((part, index) =>
        <MessageImage key={index} src={part.url || part.path} alt={`图片附件 ${index + 1}`} />)}
    </div>}
    {showBubble && <div className={`${styles.userBubble} ${userStyles.bubble}`}>
      {mentions.map((part, index) =>
        part.path && isFileReference(part.path)
          ? <FileMenu path={part.path} key={`reference-${index}`}>{part.name || part.path}</FileMenu>
          : <span className={styles.imageLabel} key={`reference-${index}`}>
          {part.path?.startsWith(CONVERSATION_PREFIX) ? "引用对话" : part.path?.startsWith("plugin://")
            ? "插件" : "附件"}：{part.name || part.path}
        </span>)}
      {editing && onEdit ? <UserMessageEditor text={text} images={images}
        skills={parts.flatMap((part) => part.type === "skill" && part.path
          ? [{ name: part.name ?? "", path: part.path }] : [])}
        disabled={editDisabled} onSubmit={onEdit}
        onCancel={() => setEditing(false)} /> : <>
        <MessageQuotes key={text} quotes={message.quotes} />
        {message.text && <div>{message.text}</div>}
      </>}
    </div>}
    {!editing && <div className={styles.userMessageActions}>
      {sentAt && <time dateTime={sentAt.toISOString()} title={sentAt.toLocaleString("zh-CN")}>
        {sentAtFormatter.format(sentAt)}
      </time>}
      <CopyButton text={text} />
      {onEdit && !editing && <Button type="text" size="small" aria-label="编辑消息" disabled={editDisabled}
        icon={<Pencil size={14} />} onClick={() => setEditing(true)} />}
    </div>}
  </article>;
}
