import type { Item } from "./types";

export const CONTINUE_MESSAGE = "请继续完成刚才中断的任务。";

/** History stores the continue button's instruction as an ordinary user message. */
export function visibleContinuationItems(items: Item[]): Item[] {
  const firstUserIndex = items.findIndex((item) => item.type === "userMessage");
  const content = items[firstUserIndex]?.content;
  if (content?.length !== 1) return items;
  const part = content[0];
  if (typeof part === "string" || part.type !== "text" || part.text !== CONTINUE_MESSAGE) return items;
  return items.filter((_, index) => index !== firstUserIndex);
}
