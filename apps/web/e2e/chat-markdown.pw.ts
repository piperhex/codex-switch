import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import fixture from '../../../shared/chat/markdownFixture.json' with { type: 'json' };
import { screenshot } from './chat-helpers';
const { markdownAnswer, markdownQuestion } = fixture;
const require = createRequire(import.meta.url);
const { parseMarkdown, renderMathParagraph }: typeof import('../../native/src/chat/markdownTree') =
  require('../../native/src/chat/markdownTree');
const { mathDocument }: typeof import('../../native/src/chat/mathDocument') = require('../../native/src/chat/mathDocument');

test('renders the reported question and boxed answer without exposing Markdown source', async ({ page }, info) => {
  await page.route('**/display-fixture.json', route => route.fulfill({ json: {
    id: 'math', cwd: '', preview: '糖果题', updatedAt: 1, turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'question', type: 'userMessage', text: markdownQuestion },
      { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: markdownAnswer },
    ] }],
  } }));
  await page.goto('e2e/chat-display-harness.html');
  await expect(page.locator('.chat-user-message table tr')).toHaveCount(3);
  await expect(page.locator('.chat-user-message')).not.toContainText('&#x20;');
  await expect(page.locator('.chat-assistant-message .katex')).toHaveCount(6);
  await expect(page.locator('.katex-display .fbox')).toBeVisible();
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(await page.locator('.chat-messages').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await screenshot(page, info, 'candy-markdown');
});

test('native formula document loads its fonts offline and reports its complete height', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const formula = parseMarkdown(String.raw`\[\boxed{29\text{ 个}} + \frac{1}{2}\]`);
  const html = mathDocument(renderMathParagraph(formula));
  await page.route('**/*', route => route.abort());
  await page.setContent(html.replace('<script>', `<script>
    window.mathReports=[];
    window.ReactNativeWebView={postMessage:value=>window.mathReports.push(JSON.parse(value).height)};
  </script><script>`));
  await expect(page.locator('.katex-display .fbox')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true);
  const height = await page.locator('#content').evaluate(node => Math.ceil(node.getBoundingClientRect().height));
  expect(height).toBeGreaterThan(32);
  await expect.poll(() => page.evaluate('window.mathReports.at(-1)')).toBe(height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, info, 'native-offline-math');
  const long = parseMarkdown(`\\[${Array.from({ length: 60 }, (_, index) => `x_{${index}}`).join('+')}\\]`);
  await page.setContent(mathDocument(renderMathParagraph(long)));
  const viewport = page.locator('#content');
  expect(await viewport.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await viewport.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  expect(await viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
