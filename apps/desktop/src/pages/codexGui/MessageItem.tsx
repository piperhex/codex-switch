import { memo } from "react";
import { useGuiLanguage } from '../../i18n/useGuiLanguage';
import { ModelChangeNotice } from "./ModelChangeNotice";
import type { Item } from "./types";
import type { SubmitMessageEdit } from "./messageEditContent";
import { ActivityRow } from "./ActivityRow";
import { RichText } from "./RichText";
import { MessageActions } from "./MessageActions";
import { UserMessage } from "./UserMessage";
import { useStreamingText } from "./useStreamingText";
import styles from "./styles.module.less";
import activeStyles from "./activeText.module.less";

function AgentMessage({ item, streaming, completedAt, onFork, forkDisabled }: {
  item: Item; streaming: boolean; completedAt?: number | null; onFork?: () => void; forkDisabled?: boolean;
}) {
  const text = item.text ?? "";
  const visible = useStreamingText(text, streaming);
  return <article className={styles.agentMessage} data-phase={item.phase ?? "final_answer"}
    data-streaming={streaming || undefined}>
    <div data-quote-source={item.id} className={streaming ? activeStyles.response : undefined}>
      <RichText text={visible} trailing={!streaming && item.phase !== "commentary" && text.trim()
        ? <MessageActions text={text} completedAt={completedAt} onFork={onFork}
          forkDisabled={forkDisabled} /> : undefined} /></div>
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

export const MessageItem = memo(function MessageItem({ item, streaming, startedAt, onEdit, editDisabled,
  completedAt, onFork, forkDisabled }: {
  item: Item; streaming: boolean; startedAt?: number | null;
  onEdit?: SubmitMessageEdit; editDisabled?: boolean;
  completedAt?: number | null; onFork?: () => void; forkDisabled?: boolean;
}) {
  useGuiLanguage();
  if (item.type === "modelChange") return <ModelChangeNotice item={item} />;
  if (item.type === "userMessage") return <UserMessage item={item} startedAt={startedAt}
    onEdit={onEdit} editDisabled={editDisabled} />;
  if (item.type === "agentMessage") return <AgentMessage item={item} streaming={streaming}
    completedAt={completedAt} onFork={onFork} forkDisabled={forkDisabled} />;
  const text = toolText(item);
  if (item.type === "reasoning" && !text.trim()) return null;
  return <ActivityRow item={item} text={text} />;
});
