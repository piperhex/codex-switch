import { expect, test, type Page } from '@playwright/test';
import { longMarkdown, markdown } from './file-preview-fixture';
import { screenshot } from './chat-helpers';

async function open(page: Page, path = 'verification.md') {
  await page.goto(`e2e/file-preview-harness.html?path=${encodeURIComponent(path)}`);
}
async function clipboard(page: Page) {
  return page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));
}

test('renders Markdown, preserves source copying and contains tables on narrow screens', async ({ page }, info) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const rendered = page.locator('.chat-markdown-preview .chat-markdown');
  await expect(rendered.getByRole('heading', { name: '文件预览', exact: true })).toBeVisible();
  await expect(rendered.locator('strong')).toHaveText('Markdown 渲染');
  await expect(rendered.locator('li')).toHaveCount(2);
  await expect(rendered.getByRole('cell', { name: '通过', exact: true })).toBeVisible();
  await expect(rendered.locator('pre')).toHaveText('const ready = true;');
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeVisible();
  await expect(page.getByText('引用位置：第 3 行')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'previewScriptRan'))).toBeUndefined();
  await page.getByRole('button', { name: '复制原文', exact: true }).click();
  expect(await clipboard(page)).toBe(markdown);
  const table = await rendered.locator('table').boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await screenshot(page, info, 'markdown-file-preview');
  await page.getByRole('button', { name: '原文', exact: true }).click();
  await expect(rendered).toHaveCount(0);
  await expect(page.locator('.chat-markdown-preview pre')).toHaveText(markdown);
  await page.getByRole('button', { name: '复制原文', exact: true }).first().click();
  expect(await clipboard(page)).toBe(markdown);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(rendered.locator('table')).toBeVisible();
});

test('copies the complete source even when the long source view is paginated', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, 'long.md');
  await page.getByRole('button', { name: '原文', exact: true }).click();
  await expect(page.locator('pre')).not.toContainText('最后一行');
  await page.getByRole('button', { name: '复制原文', exact: true }).first().click();
  expect(await clipboard(page)).toBe(longMarkdown);
});

test('handles uppercase extensions, empty files, ordinary source and load failures', async ({ page }) => {
  await open(page, 'README.MARKDOWN');
  await expect(page.locator('.chat-markdown-preview table')).toBeVisible();
  await open(page, 'empty.md');
  await expect(page.getByText('（空文件）')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制原文' })).toBeEnabled();
  await open(page, 'source.ts');
  await expect(page.locator('.chat-markdown-preview')).toHaveCount(0);
  await expect(page.locator('pre')).toHaveText('const ready = true;\n');
  await expect(page.getByRole('button', { name: '复制文件内容' })).toBeVisible();
  await open(page, 'missing.md');
  await expect(page.getByRole('status')).toContainText('暂时无法预览此文件');
  await expect(page.getByRole('button', { name: '复制原文' })).toHaveCount(0);
});
