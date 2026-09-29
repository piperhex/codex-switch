import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { mathOptions, normalizeMathDelimiters } from "../../../../../../shared/chat/mathMarkdown";
import { FileMenu } from "../FileMenu";
import { CodeBlock } from "../CodeBlock";
import { MarkdownTable } from "../MarkdownTable";
import { MessageLink } from "../MessageLink";
import { previewImageUrl, previewReference } from "./references";
import chatStyles from "../styles.module.less";
import styles from "./preview.module.less";
import "katex/dist/katex.min.css";

export function PreviewMarkdown({ text, path, url }: { text: string; path: string; url: string }) {
  const components: Components = {
    a: ({ href, children }) => {
      const reference = href ? previewReference(href, path) : undefined;
      if (reference) return <FileMenu {...reference} preview>{children}</FileMenu>;
      return <MessageLink href={href}>{children}</MessageLink>;
    },
    img: ({ src, alt }) => <img src={previewImageUrl(src, url, path)} alt={alt ?? "图片"}
      loading="lazy" referrerPolicy="no-referrer" />,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
  };
  return <article className={`${styles.document} ${chatStyles.markdown}`}>
    <Markdown remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]} rehypePlugins={[[rehypeKatex, mathOptions]]}
      skipHtml components={components} urlTransform={(value, key) => {
        if (key === "href" && previewReference(value, path)) return value;
        if (key === "src" && previewImageUrl(value, url, path)) return value;
        return defaultUrlTransform(value);
      }}>{normalizeMathDelimiters(text)}</Markdown>
  </article>;
}
