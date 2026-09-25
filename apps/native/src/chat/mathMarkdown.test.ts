import { expect, it } from 'vitest';
import { normalizeMathDelimiters } from '../../../../shared/chat/mathMarkdown';
import { markdownAnswer, markdownQuestion } from '../../../../shared/chat/markdownFixture.json';
import { hasMarkdownMath, parseMarkdown, renderMathParagraph, type MarkdownNode } from './markdownTree';
import { mathDocument, mathHeight } from './mathDocument';

function descendants(nodes: MarkdownNode[]): MarkdownNode[] {
  return nodes.flatMap(node => [node, ...descendants(node.children)]);
}

it('parses the reported answer before Markdown consumes the TeX delimiter backslashes', () => {
  const nodes = descendants(parseMarkdown(markdownAnswer));
  const math = nodes.filter(node => node.token.type.startsWith('math_'));
  expect(math.map(node => node.token.content.trim())).toEqual(['28', '8+4=12', '7', '9', '16',
    String.raw`\boxed{29\text{ 个}}`]);
  const markup = renderMathParagraph([math[5]]);
  expect(markup).toContain('class="katex-display"');
  expect(markup).toContain('class="stretchy fbox"');
  expect(markup).toContain('个');
  expect(markup).not.toContain('katex-error');
});

it('decodes entities and preserves the original table structure', () => {
  const nodes = descendants(parseMarkdown(markdownQuestion, true));
  expect(nodes.filter(node => node.token.type === 'tr_open')).toHaveLength(3);
  expect(nodes.filter(node => node.token.type === 'th_open')).toHaveLength(4);
  const text = nodes.filter(node => node.token.type === 'text').map(node => node.token.content).join('');
  expect(text).toContain('圆形798五角星形764');
  expect(text).not.toContain('&#x20;');
});

it('preserves user-authored HTML as literal text when adding Markdown rendering', () => {
  const source = '<instruction>保留原文</instruction>\n\n' + String.raw`<b>答案</b> \(29\)`;
  const nodes = descendants(parseMarkdown(source, true));
  const text = nodes.filter(node => node.token.type === 'text').map(node => node.token.content).join('');
  expect(text).toContain('<instruction>保留原文</instruction>');
  const markup = renderMathParagraph(parseMarkdown(String.raw`<b>答案</b> \(29\)`, true)[0].children[0].children);
  expect(markup).toContain('&lt;b&gt;答案&lt;/b&gt;');
});

it.each([
  '`\\(x\\)`', '`` `\\[x\\]` ``', '```tex\n\\[x\\]\n```', '~~~tex\n\\(x\\)\n~~~',
  '```tex\n\\[unfinished', '> ```tex\n> \\(x\\)\n> ```', String.raw`\\(literal\\)`,
  '    \\[x\\]', '\t\\(x\\)',
])('leaves code and escaped delimiters unchanged: %s', text => {
  expect(normalizeMathDelimiters(text)).toBe(text);
  expect(parseMarkdown(text).some(hasMarkdownMath)).toBe(false);
});

it('handles dollars, incomplete streaming formulas and multiple inline expressions', () => {
  expect(parseMarkdown('$x^2$ and $$y^2$$').some(hasMarkdownMath)).toBe(true);
  expect(normalizeMathDelimiters(String.raw`还未完成 \[\boxed{29`)).toBe(String.raw`还未完成 \[\boxed{29`);
  expect(normalizeMathDelimiters(String.raw`\(a\) + \(b\)`)).toBe('$a$ + $b$');
});

it('keeps formatting in math paragraphs and does not restore raw HTML or unsafe links', () => {
  const nodes = parseMarkdown(String.raw`**答案** \(29\) <img src=x onerror=alert(1)> [链接](https://example.com)`);
  const markup = renderMathParagraph(nodes[0].children[0].children);
  expect(markup).toContain('<strong>答案</strong>');
  expect(markup).toContain('class="katex"');
  expect(markup).toContain('href="https://example.com"');
  expect(markup).not.toContain('<img');
  const unsafe = renderMathParagraph(parseMarkdown(String.raw`\[\href{javascript:alert(1)}{x}\]`));
  expect(unsafe).not.toContain('href="javascript:');
});

it('bundles fonts offline and validates WebView height reports', () => {
  const html = mathDocument('<span>29 个</span>');
  expect(html).toContain('data:font/woff2;base64,');
  expect(html).not.toMatch(/url\(fonts\//);
  expect(html).toContain("default-src 'none'");
  expect(mathHeight('{"height":52.2}')).toBe(53);
  for (const value of ['null', '{"height":"50"}', '{"height":-1}', 'invalid']) {
    expect(mathHeight(value)).toBeNull();
  }
});
