import type { Content, Conversation, MessageInput } from "./types";
import type { MessageEdit } from "./editMessage";
import { retainedMessageParts } from "./messageEditContent";
import { referenceKind } from "./conversationReferences";

/** Preserve attachments and steering inputs if rollback succeeds but resending fails. */
export function editedMessageDraft(value: Conversation, edit: MessageEdit): MessageInput {
  const draft: MessageInput = { text: "", images: [], skills: [], attachments: [] };
  const messages = value.turns.find((turn) => turn.id === edit.turnId)?.items ?? [];
  const text: string[] = [];
  for (const message of messages.filter((item) => item.type === "userMessage")) {
    if (message.id === edit.itemId) text.push(edit.text);
    const parts = (message.content ?? []).filter((part): part is Content => typeof part !== "string");
    const retained = retainedMessageParts(parts, message.id === edit.itemId ? edit.removedImageIndexes : []);
    for (const part of retained) {
      if (part.type === "text" && message.id !== edit.itemId && part.text) text.push(part.text);
      if (part.type === "image" && part.url) draft.images.push(part.url);
      if (part.type === "localImage" && part.path) draft.images.push(part.path);
      if (part.type === "skill" && part.path && (message.id !== edit.itemId || edit.skills === undefined)) {
        draft.skills.push({ name: part.name ?? "", path: part.path });
      }
      if (part.type === "mention" && part.path) draft.attachments!.push({
        kind: referenceKind(part.path), name: part.name ?? "", path: part.path,
      });
    }
    if (message.id === edit.itemId) {
      draft.images.push(...(edit.images ?? []));
      draft.skills.push(...(edit.skills ?? []));
      break;
    }
  }
  draft.text = text.join("\n\n");
  return draft;
}
