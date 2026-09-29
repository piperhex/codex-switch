import { memo, useMemo, type ReactNode } from "react";
import { common, createLowlight } from "lowlight";
import type { RootContent } from "hast";
import styles from "./CodeBlock.module.less";

const highlighter = createLowlight(common);
const MAX_HIGHLIGHT_CHARACTERS = 30_000;
export { fileLanguage } from "./filePreview/fileLanguages";

export function renderToken(node: RootContent, index: number): ReactNode {
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
