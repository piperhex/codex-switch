import { Children, isValidElement, useMemo, useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { DiffView } from "./DiffView";
import { parseDiff } from "./diff";
import styles from "./CodeBlock.module.less";
import { HighlightedCode } from "./CodeHighlight";

export function CodeBlock({ children }: { children?: ReactNode }) {
  const [wrapped, setWrapped] = useState(false);
  const child = Children.toArray(children).find(isValidElement);
  const props = child?.props as { className?: string; children?: ReactNode } | undefined;
  const text = typeof props?.children === "string" ? props.children : "";
  const language = props?.className?.match(/language-([\w+-]+)/)?.[1] ?? "";
  const diff = useMemo(() => ["diff", "patch"].includes(language) ? parseDiff(text) : [], [language, text]);
  if (diff.length) return <DiffView files={diff} title="代码差异" />;
  return <div className={styles.block}>
    <div className={styles.toolbar}><span>{language || "代码"}</span>
      <button type="button" aria-pressed={wrapped} onClick={() => setWrapped(!wrapped)}>自动换行</button>
      <CopyButton text={text.replace(/\n$/, "")} label="复制代码" />
    </div>
    <pre className={wrapped ? styles.wrapped : undefined}>
      <HighlightedCode text={text} language={language} />
    </pre>
  </div>;
}
