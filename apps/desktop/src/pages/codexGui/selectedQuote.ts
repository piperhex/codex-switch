import type { ReplyQuote } from "./replyQuotes";

export interface SelectedQuote { quote: ReplyQuote; left: number; top: number }
const MENU_WIDTH = 120;
const MENU_HEIGHT = 36;
const VIEWPORT_MARGIN = 8;

function quoteSource(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  if (element?.closest("button, input, textarea, [contenteditable], [data-quote-exclude]")) return null;
  return element?.closest<HTMLElement>("[data-quote-source]") ?? null;
}

export function selectedQuote(root: HTMLElement): SelectedQuote | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const source = quoteSource(range.startContainer);
  if (!source || !root.contains(source) || source !== quoteSource(range.endContainer)) return null;
  const text = selection.toString().trim();
  const messageId = source.dataset.quoteSource;
  if (!messageId || !text) return null;
  const bounds = range.getBoundingClientRect();
  if (!bounds.width && !bounds.height) return null;
  return { quote: { messageId, text },
    left: Math.max(VIEWPORT_MARGIN, Math.min(bounds.left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(bounds.bottom + VIEWPORT_MARGIN,
      window.innerHeight - MENU_HEIGHT - VIEWPORT_MARGIN)) };
}
