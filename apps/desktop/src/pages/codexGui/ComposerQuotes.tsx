import { useEffect, useState } from "react";
import { Popover } from "antd";
import { MessageSquareQuote, X } from "lucide-react";
import { quoteKey, type ReplyQuote } from "./replyQuotes";
import styles from "./ReplyQuotes.module.less";

export function ComposerQuotes({ quotes, draftKey, active, disabled, onRemove, onClear }: {
  quotes: ReplyQuote[]; draftKey: string; active: boolean; disabled: boolean;
  onRemove: (key: string) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [draftKey, active, disabled]);
  useEffect(() => { if (!quotes.length) setOpen(false); }, [quotes.length]);
  if (!quotes.length) return null;
  const content = <div className={styles.preview} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
  }}>
    <div className={styles.heading}>引用的回答</div>
    <ol>{quotes.map((quote, index) => <li key={quoteKey(quote)}>
      <blockquote>{quote.text}</blockquote>
      <button type="button" disabled={disabled} className={styles.remove}
        aria-label={`移除第 ${index + 1} 条引用`} onClick={() => onRemove(quoteKey(quote))}>
        <X size={14} aria-hidden="true" />
      </button>
    </li>)}</ol>
  </div>;
  return <div className={styles.quotes} aria-label="引用的回答">
    <span className={styles.chip}>
      <Popover trigger="click" placement="topLeft" arrow={false} content={content}
        open={open && active} onOpenChange={setOpen}
        styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 12 } }}>
        <button type="button" className={styles.previewButton} aria-label={`查看 ${quotes.length} 条引用`}
          aria-expanded={open && active}>
          <MessageSquareQuote size={15} aria-hidden="true" />{quotes.length} 条引用
        </button>
      </Popover>
      <button type="button" className={styles.remove} disabled={disabled} aria-label="移除全部引用" onClick={onClear}>
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  </div>;
}
