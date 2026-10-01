import { guiText } from "../../i18n/guiText";
import type { AttachmentReference } from "./attachmentTypes";
import type { Conversation, Thread } from "./types";

export const CONVERSATION_PREFIX = "codex-thread://";
export const MAX_CONVERSATION_REFERENCES = 8;
const MAX_TITLE_LENGTH = 160;

export function conversationReference(thread: Thread): AttachmentReference {
  const name = (thread.name?.trim() || thread.preview?.trim() || guiText("未命名对话"))
    .replace(/[\x00-\x1f\x7f]/gu, " ").slice(0, MAX_TITLE_LENGTH);
  return { kind: "conversation", name, path: `${CONVERSATION_PREFIX}${thread.id}` };
}

export function conversationCandidates(options: {
  remote: Thread[]; known: Thread[]; conversations: Record<string, Conversation>;
  currentId: string | null; query: string;
}) {
  const threads = new Map(options.known.map((thread) => [thread.id, thread]));
  options.remote.forEach((thread) => threads.set(thread.id, thread));
  Object.values(options.conversations).forEach((value) => {
    if (threads.has(value.thread.id) || value.activeTurn) {
      threads.set(value.thread.id, { ...threads.get(value.thread.id), ...value.thread,
        status: { type: value.activeTurn ? "active" : "idle" } });
    }
  });
  const query = options.query.trim().toLocaleLowerCase();
  return [...threads.values()].filter((thread) => thread.id !== options.currentId
    && `${thread.name ?? ""} ${thread.preview} ${thread.cwd} ${thread.id}`.toLocaleLowerCase().includes(query))
    .sort((left, right) => Number(right.status?.type === "active") - Number(left.status?.type === "active")
      || right.updatedAt - left.updatedAt);
}

export function referenceKind(path: string): AttachmentReference["kind"] {
  if (path.startsWith(CONVERSATION_PREFIX)) return "conversation";
  return path.startsWith("plugin://") ? "plugin" : "file";
}
