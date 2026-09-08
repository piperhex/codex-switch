import { Children, isValidElement, memo, useMemo, useState, type ReactNode } from "react";
import { common, createLowlight } from "lowlight";
import type { RootContent } from "hast";
import { CopyButton } from "./CopyButton";
import { DiffView } from "./DiffView";
import { parseDiff } from "./diff";
import styles from "./CodeBlock.module.less";

const highlighter = createLowlight(common);
const MAX_HIGHLIGHT_CHARACTERS = 30_000;

function renderToken(node: RootContent, index: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const classes = node.properties.className;
  return <span key={index} className={Array.isArray(classes) ? classes.join(" ") : undefined}>
    {node.children.map(renderToken)}</span>;
}

export const HighlightedCode = memo(function HighlightedCode({ text, language }: { text: string; language: string }) {
  const tokens = useMemo(() => {
    if (!language || text.length > MAX_HIGHLIGHT_CHARACTERS || !highlighter.registered(language)) return text;
    return highlighter.highlight(language, text).children.map(renderToken);
  }, [text, language]);
  return <code className={styles.highlight}>{tokens}</code>;
});

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
