import { memo, useMemo, type ReactNode } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { mathOptions, normalizeMathDelimiters } from "../../../../../shared/chat/mathMarkdown";
import "katex/dist/katex.min.css";
import { CodeBlock } from "./CodeBlock";
import { MessageImage } from "./MessageImage";
import { isInlineImage, localImageSource } from "./imageSources";
import { MessageLink, isFileReference } from "./MessageLink";
import styles from "./styles.module.less";
import { CodeReviewComment } from "./CodeReviewComment";
import { messageSections } from "./messageDirectives";
import { MarkdownTable } from "./MarkdownTable";

const COMPONENTS: Components = {
  a: ({ href, children }) => <MessageLink href={href}>{children}</MessageLink>,
  img: ({ src, alt, title }) => <MessageImage key={src} src={src} alt={alt} title={title} />,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
};
const PLUGINS = [remarkGfm, remarkMath, remarkBreaks];

export const RichText = memo(function RichText({ text, trailing }: { text: string; trailing?: ReactNode }) {
  const sections = useMemo(() => messageSections(text), [text]);
  return <div className={styles.markdown}>
    {sections.map((section, index) => section.type === "review"
      ? <CodeReviewComment key={index} comment={section.comment} />
      : <Markdown key={index} remarkPlugins={PLUGINS} rehypePlugins={[[rehypeKatex, mathOptions]]}
        skipHtml components={COMPONENTS} urlTransform={(url, key) => {
      if (key === "src" && (isInlineImage(url) || localImageSource(url))) return url;
      if (key === "href" && (isFileReference(url) || localImageSource(url))) return url;
      return defaultUrlTransform(url);
    }}>{normalizeMathDelimiters(section.text)}</Markdown>)}
    {trailing && <div className={styles.messageCopy} data-quote-exclude>{trailing}</div>}
  </div>;
});
