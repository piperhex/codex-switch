import type { Conversation, MessageInput } from "./types";
import type { MessageEdit } from "./editMessage";

/** Preserve attachments and steering inputs if rollback succeeds but resending fails. */
export function editedMessageDraft(value: Conversation, edit: MessageEdit): MessageInput {
  const draft: MessageInput = { text: "", images: [], skills: [], attachments: [] };
  const messages = value.turns.find((turn) => turn.id === edit.turnId)?.items ?? [];
  const text: string[] = [];
  for (const message of messages.filter((item) => item.type === "userMessage")) {
    if (message.id === edit.itemId) text.push(edit.text);
    for (const part of message.content ?? []) {
      if (typeof part === "string") continue;
      if (part.type === "text" && message.id !== edit.itemId && part.text) text.push(part.text);
      if (part.type === "image" && part.url) draft.images.push(part.url);
      if (part.type === "localImage" && part.path) draft.images.push(part.path);
      if (part.type === "skill" && part.path) draft.skills.push({ name: part.name ?? "", path: part.path });
      if (part.type === "mention" && part.path) draft.attachments!.push({
        kind: part.path.startsWith("plugin://") ? "plugin" : "file", name: part.name ?? "", path: part.path,
      });
    }
    if (message.id === edit.itemId) break;
  }
  draft.text = text.join("\n\n");
  return draft;
}
