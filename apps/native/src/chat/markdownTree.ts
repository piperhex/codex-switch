import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { mathOptions, normalizeMathDelimiters } from '../../../../shared/chat/mathMarkdown';

function createParser(html: boolean) {
  const result = new MarkdownIt({ html, breaks: true, linkify: true, typographer: false, maxNesting: 20 });
  result.use(texmath, { engine: katex, delimiters: ['dollars'], katexOptions: { ...mathOptions } });
  result.renderer.rules.html_inline = () => '';
  result.renderer.rules.html_block = () => '';
  const validateLink = result.validateLink.bind(result);
  result.validateLink = (url) => validateLink(url) || Boolean(parseFileReference(url));
  return result;
}

// Assistant HTML is discarded; user-authored tags remain visible as literal text.
const parser = createParser(true);
const userParser = createParser(false);
type Token = ReturnType<typeof parser.parse>[number];
export interface MarkdownNode { token: Token; children: MarkdownNode[]; task?: boolean }

function tree(tokens: Token[]): MarkdownNode[] {
  const root: MarkdownNode[] = [];
  const stack = [root];
  for (const token of tokens) {
    if (token.type === 'html_block' || token.type === 'html_inline') continue;
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: MarkdownNode = { token, children: token.children ? tree(token.children) : [] };
    stack[stack.length - 1].push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return root;
}

function markTasks(nodes: MarkdownNode[]) {
  for (const node of nodes) {
    if (node.token.type === 'list_item_open') {
      const first = node.children[0]?.children[0]?.children[0];
      const match = first?.token.type === 'text' ? first.token.content.match(/^\[([ xX])\](?:[ \t]+|$)/) : null;
      if (first && match) {
        node.task = match[1].toLowerCase() === 'x';
        first.token.content = first.token.content.slice(match[0].length);
      }
    }
    markTasks(node.children);
  }
}

/** Keep complete blocks intact so large fenced code stays formatted and copies in full. */
export function parseMarkdown(text: string, user = false): MarkdownNode[] {
  const nodes = tree((user ? userParser : parser).parse(normalizeMathDelimiters(text), {}));
  markTasks(nodes);
  return nodes;
}

export function hasMarkdownImage(node: MarkdownNode): boolean {
  return node.token.type === 'image' || node.children.some(hasMarkdownImage);
}

export function hasMarkdownMath(node: MarkdownNode): boolean {
  return node.token.type.startsWith('math_') || node.children.some(hasMarkdownMath);
}

/** Rebuild closing tokens to reuse the safe HTML renderer for paragraphs containing math. */
export function renderMathParagraph(nodes: MarkdownNode[]): string {
  const tokens = nodes.flatMap(function flatten(node): Token[] {
    const token = node.token;
    if (token.type === 'html_inline' || token.type === 'html_block') return [];
    if (token.nesting !== 1) return [token];
    const closing = Object.assign(Object.create(Object.getPrototypeOf(token)), token, { nesting: -1,
      type: token.type.replace(/_open$/, '_close') }) as Token;
    return [token, ...node.children.flatMap(flatten), closing];
  });
  return parser.renderer.renderInline(tokens, parser.options, {});
}
