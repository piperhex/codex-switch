import type { Item, Turn } from "./types";
import { visibleUserContent } from "../../../../../shared/chat/conversationContext";

import { CONTINUE_MESSAGE } from "../../../../../shared/remote-chat/composerAction";
export { CONTINUE_MESSAGE } from "../../../../../shared/remote-chat/composerAction";

export function followsStoppedTurn(turn?: Turn): boolean {
  return turn?.status === "interrupted" || turn?.status === "failed";
}

/** History stores the continue button's instruction as an ordinary user message. */
export function visibleContinuationItems(items: Item[]): Item[] {
  const firstUserIndex = items.findIndex((item) => item.type === "userMessage");
  const content = visibleUserContent(items[firstUserIndex]?.content);
  if (content.some((part) => part.type !== "text")) return items;
  if (content.map((part) => part.text ?? "").join("\n").trim() !== CONTINUE_MESSAGE) return items;
  return items.filter((_, index) => index !== firstUserIndex);
}
