import type { Item } from "./types";

import { CONTINUE_MESSAGE } from "../../../../../shared/remote-chat/composerAction";
export { CONTINUE_MESSAGE } from "../../../../../shared/remote-chat/composerAction";

/** History stores the continue button's instruction as an ordinary user message. */
export function visibleContinuationItems(items: Item[]): Item[] {
  const firstUserIndex = items.findIndex((item) => item.type === "userMessage");
  const content = items[firstUserIndex]?.content;
  if (content?.length !== 1) return items;
  const part = content[0];
  if (typeof part === "string" || part.type !== "text" || part.text !== CONTINUE_MESSAGE) return items;
  return items.filter((_, index) => index !== firstUserIndex);
}
