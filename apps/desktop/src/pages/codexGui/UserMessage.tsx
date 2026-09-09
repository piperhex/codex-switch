import type { Content, Item } from "./types";
import { CopyButton } from "./CopyButton";
import { MessageImage } from "./MessageImage";
import styles from "./styles.module.less";

const MILLISECONDS_PER_SECOND = 1000;
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function UserMessage({ item, startedAt }: { item: Item; startedAt?: number | null }) {
  const parts = (item.content ?? []) as Content[];
  const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const date = startedAt == null ? null : new Date(startedAt * MILLISECONDS_PER_SECOND);
  const sentAt = date && Number.isFinite(date.getTime()) ? date : null;
  return <article className={styles.userMessage}>
    <div className={styles.userBubble}>
      {parts.filter((part) => part.type === "localImage" || part.type === "image").map((part, index) =>
        part.url ? <MessageImage key={index} src={part.url} alt={`图片附件 ${index + 1}`} />
          : <span className={styles.imageLabel} key={index}>图片：{part.path?.split(/[\\/]/).pop() ?? "附件"}</span>)}
      {parts.filter((part) => part.type === "mention").map((part, index) =>
        <span className={styles.imageLabel} key={`reference-${index}`}>
          {part.path?.startsWith("plugin://") ? "插件" : "附件"}：{part.name || part.path}
        </span>)}
      <div>{text}</div>
    </div>
    <div className={styles.userMessageActions}>
      {sentAt && <time dateTime={sentAt.toISOString()} title={sentAt.toLocaleString("zh-CN")}>
        {timeFormatter.format(sentAt)}
      </time>}
      <CopyButton text={text} />
    </div>
  </article>;
}
