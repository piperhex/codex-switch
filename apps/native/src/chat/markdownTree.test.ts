import { expect, it } from 'vitest';
import { parseMarkdown, renderMathParagraph, type MarkdownNode } from './markdownTree';
import { answer } from '../../../../shared/chat/lineBreakFixture.json';

function descendants(nodes: MarkdownNode[]): MarkdownNode[] {
  return nodes.flatMap((node) => [node, ...descendants(node.children)]);
}

it('keeps each answer line when native paragraphs use the HTML renderer', () => {
  const nodes = parseMarkdown(answer);
  expect(renderMathParagraph(nodes[0].children[0].children).split('<br>\n')).toEqual(answer.split('\n'));
});

it('renders soft and hard breaks once in paragraphs containing formulas', () => {
  const nodes = parseMarkdown('第一行 $x$\n第二行  \n第三行\\\n第四行');
  const markup = renderMathParagraph(nodes[0].children[0].children);
  expect(markup.match(/<br>/g)).toHaveLength(3);
  expect(markup).toContain('katex');
});

it('keeps nested task states without showing their Markdown markers', () => {
  const nodes = descendants(parseMarkdown('- [x] **完成**\n  - [ ] 待办\n- 普通条目\n- [X] done\n- [x]without-space'));
  const items = nodes.filter((node) => node.token.type === 'list_item_open');
  expect(items.map((node) => node.task)).toEqual([true, false, undefined, true, undefined]);
  const text = nodes.filter((node) => node.token.type === 'text').map((node) => node.token.content).join('');
  expect(text).toBe('完成待办普通条目done[x]without-space');
});

it('retains heading levels, strikethrough, aligned table headers and explicit line breaks', () => {
  const nodes = descendants(parseMarkdown('# 大标题\n\n### 小标题\n\n~~旧值~~\n新值  \n换行\n\n'
    + '| 名称 | 数量 |\n| :--- | ---: |\n| 测试 | 2 |'));
  expect(nodes.filter((node) => node.token.type === 'heading_open').map((node) => node.token.tag))
    .toEqual(['h1', 'h3']);
  expect(nodes.map((node) => node.token.type)).toEqual(expect.arrayContaining(['s_open', 'softbreak', 'hardbreak']));
  expect(nodes.filter((node) => node.token.type === 'th_open').map((node) => node.token.attrGet('style')))
    .toEqual(['text-align:left', 'text-align:right']);
});

it('keeps safe auto-links and local file links while rejecting executable destinations', () => {
  const nodes = descendants(parseMarkdown('https://example.com [源码](<F:/demo/file.ts:12>) '
    + '[恶意](javascript:alert(1)) ![图片](data:image/png;base64,AAAA)'));
  expect(nodes.filter((node) => node.token.type === 'link_open').map((node) => node.token.attrGet('href')))
    .toEqual(['https://example.com', 'F:/demo/file.ts:12']);
  expect(nodes.find((node) => node.token.type === 'image')?.token.attrGet('src')).toBe('data:image/png;base64,AAAA');
});

it('preserves an entire large fenced block and formatting after the old preview boundary', () => {
  const code = 'const value = "完整文本";\n'.repeat(1_500);
  const nodes = parseMarkdown(`\`\`\`typescript\n${code}\`\`\`\n\n## 后续内容`);
  expect(nodes[0].token.content).toBe(code);
  expect(nodes[1].token.tag).toBe('h2');
});

it('discards raw HTML like the desktop renderer while retaining inline text and code', () => {
  const nodes = descendants(parseMarkdown('Hello <b>world</b> `<b>code</b>`\n\n<script>alert(1)</script>'));
  expect(nodes.some((node) => node.token.type.startsWith('html'))).toBe(false);
  expect(nodes.filter((node) => ['text', 'code_inline'].includes(node.token.type))
    .map((node) => node.token.content).join('')).toBe('Hello world <b>code</b>');
});
