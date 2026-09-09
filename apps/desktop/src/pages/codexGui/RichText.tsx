import { memo, useMemo } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { MessageImage } from "./MessageImage";
import { isInlineImage, localImageSource } from "./imageSources";
import { MessageLink, isFileReference } from "./MessageLink";
import styles from "./styles.module.less";
import { CodeReviewComment } from "./CodeReviewComment";
import { messageSections } from "./messageDirectives";

const COMPONENTS: Components = {
  a: ({ href, children }) => <MessageLink href={href}>{children}</MessageLink>,
  img: ({ src, alt, title }) => <MessageImage key={src} src={src} alt={alt} title={title} />,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};
const PLUGINS = [remarkGfm];

export const RichText = memo(function RichText({ text }: { text: string }) {
  const sections = useMemo(() => messageSections(text), [text]);
  return <div className={styles.markdown}>
    {sections.map((section, index) => section.type === "review"
      ? <CodeReviewComment key={index} comment={section.comment} />
      : <Markdown key={index} remarkPlugins={PLUGINS} skipHtml components={COMPONENTS} urlTransform={(url, key) => {
      if (key === "src" && (isInlineImage(url) || localImageSource(url))) return url;
      if (key === "href" && (isFileReference(url) || localImageSource(url))) return url;
      return defaultUrlTransform(url);
    }}>{section.text}</Markdown>)}
  </div>;
});
