import { createPortal } from "react-dom";
import { MessageSquareQuote } from "lucide-react";
import type { SelectedQuote } from "./selectedQuote";
import styles from "./ReplyQuotes.module.less";

export function QuoteSelectionButton({ selection, onQuote }: { selection: SelectedQuote; onQuote: () => void }) {
  return createPortal(<button type="button" className={styles.selectionButton}
    style={{ left: selection.left, top: selection.top }} onMouseDown={(event) => event.preventDefault()}
    onClick={onQuote} aria-label="引用选中文字并回复">
    <MessageSquareQuote size={15} aria-hidden="true" />引用回复
  </button>, document.body);
}
