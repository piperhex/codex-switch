import { memo } from "react";
import type { Item } from "./types";
import { ActivityRow } from "./ActivityRow";
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
  // Image payloads can be several megabytes; activity text only needs the description.
  if (item.type === "imageGeneration" || item.type === "imageView") return item.revisedPrompt ?? item.path ?? "";
  if (item.type === "reasoning") {
    return [...(item.summary ?? []), ...(item.content ?? []).filter((part): part is string => typeof part === "string")]
      .join("\n\n");
  }
  // Structured results can include large screenshots. Serialize unknown tools only when their details are opened.
  return item.text ?? item.review ?? item.aggregatedOutput ?? item.query ?? "";
}

export const MessageItem = memo(function MessageItem({ item, streaming, startedAt, onEdit, editDisabled }: {
  item: Item; streaming: boolean; startedAt?: number | null;
  onEdit?: (text: string) => Promise<boolean>; editDisabled?: boolean;
}) {
  if (item.type === "userMessage") return <UserMessage item={item} startedAt={startedAt}
    onEdit={onEdit} editDisabled={editDisabled} />;
  if (item.type === "agentMessage") return <AgentMessage item={item} streaming={streaming} />;
  const text = toolText(item);
  if (item.type === "reasoning" && !text.trim()) return null;
  return <ActivityRow item={item} text={text} />;
});
