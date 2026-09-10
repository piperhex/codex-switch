import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { RichText } from "./RichText";
import styles from "./ActivityRow.module.less";

export const OUTPUT_PAGE_CHARACTERS = 8_000;

/** Bound parsing and DOM size even when a tool returns a megabyte of text in one item. */
export function ToolText({ text, markdown = false, className }: {
  text: string; markdown?: boolean; className?: string;
}) {
  const [requestedPage, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(text.length / OUTPUT_PAGE_CHARACTERS));
  const page = Math.min(requestedPage, pages - 1);
  const visible = text.slice(page * OUTPUT_PAGE_CHARACTERS, (page + 1) * OUTPUT_PAGE_CHARACTERS);
  return <>
    {markdown ? <RichText text={visible} /> : <pre className={className}>{visible}</pre>}
    {pages > 1 && <div className={styles.outputPages}>
      <span>内容较长，分段显示</span>
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>上一段</button>
      <span aria-label="内容页码">{page + 1} / {pages}</span>
      <button disabled={page === pages - 1} onClick={() => setPage(page + 1)}>下一段</button>
      <CopyButton text={text} label="复制完整内容" />
    </div>}
  </>;
}
