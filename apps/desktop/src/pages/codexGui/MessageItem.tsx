import { memo, useMemo } from "react";
import type { Item } from "./types";
import { ActivityRow } from "./ActivityRow";
import { DiffView } from "./DiffView";
import { changedFiles } from "./diff";
import { RichText } from "./RichText";
import { CopyButton } from "./CopyButton";
import { UserMessage } from "./UserMessage";
import { useStreamingText } from "./useStreamingText";
import styles from "./styles.module.less";

function AgentMessage({ item, streaming }: { item: Item; streaming: boolean }) {
  const text = item.text ?? "";
  const visible = useStreamingText(text, streaming);
  return <article className={styles.agentMessage} data-phase={item.phase ?? "final_answer"}>
    <div data-quote-source={item.id}><RichText text={visible} /></div>
    {!streaming && <CopyButton text={text} />}
  </article>;
}

function toolText(item: Item) {
  if (item.type === "reasoning") {
    return [...(item.summary ?? []), ...(item.content ?? []).filter((part): part is string => typeof part === "string")]
      .join("\n\n");
  }
  return item.text ?? item.review ?? item.aggregatedOutput ?? item.query ?? JSON.stringify(item, null, 2);
}

export const MessageItem = memo(function MessageItem({ item, streaming, startedAt }: {
  item: Item; streaming: boolean; startedAt?: number | null;
}) {
  const files = useMemo(() => changedFiles(item.changes ?? []), [item.changes]);
  if (item.type === "userMessage") return <UserMessage item={item} startedAt={startedAt} />;
  if (item.type === "agentMessage") return <AgentMessage item={item} streaming={streaming} />;
  if (item.type === "fileChange" && files.length) return <DiffView files={files} status={
    { inProgress: "正在修改", failed: "修改失败", declined: "未应用", completed: "已修改" }[item.status ?? ""]} />;
  const text = toolText(item);
  if (item.type === "reasoning" && !text.trim()) return null;
  return <ActivityRow item={item} text={text} />;
});
