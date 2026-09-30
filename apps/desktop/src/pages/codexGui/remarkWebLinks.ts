import LinkifyIt from "linkify-it";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { PhrasingContent, Root } from "mdast";
import type { Processor } from "unified";
import type {} from "remark-parse";

const linkify = new LinkifyIt({ fuzzyEmail: false });
const proseSegments = /[^，。；：！？、（）【】《》“”‘’]+/g;

/** Resolve emphasis before bare URLs so a link cannot consume closing Markdown delimiters. */
export function remarkWebLinks(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ disable: { null: ["protocolAutolink", "wwwAutolink"] } });
  // Run before GFM's fallback transform, which excludes localhost and accepts Chinese sentence punctuation.
  (data.fromMarkdownExtensions ??= []).unshift({ transforms: [linkifyText] });
}

function linkifyText(tree: Root) {
  findAndReplace(tree, [proseSegments, webLinks], { ignore: ["link", "linkReference"] });
}

function webLinks(text: string): PhrasingContent[] | false {
  const matches = linkify.match(text)?.filter(match => /^(?:https?:\/\/|www\.)/i.test(match.raw));
  if (!matches?.length) return false;
  const nodes: PhrasingContent[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) nodes.push({ type: "text", value: text.slice(cursor, match.index) });
    nodes.push({ type: "link", url: match.url, children: [{ type: "text", value: match.text }] });
    cursor = match.lastIndex;
  }
  if (cursor < text.length) nodes.push({ type: "text", value: text.slice(cursor) });
  return nodes;
}
