import { expect, test, type Page } from '@playwright/test';
import type { Thread } from '../src/chat/types';

const paths = ['src/first/index.ts', 'src/second/index.ts', 'src/third.ts', 'src/fourth.ts', 'src/fifth.ts'];
function fixture(): Thread {
  return { id: 'diff', cwd: '/remote', preview: '', updatedAt: 1, turns: [{ id: 'turn', status: 'completed',
    items: [{ id: 'user', type: 'userMessage', text: '检查本轮修改' },
      { id: 'edit', type: 'fileChange', status: 'completed', changes: paths.map((path, index) => ({
        path, kind: { type: 'update' }, diff: `@@ -1 +1 @@\n-const oldValue = ${index};\n+const newValue = ${index};\n`,
      })) }, { id: 'answer', type: 'agentMessage', text: '修改完成。' }] }] };
}
async function open(page: Page, value = fixture()) {
  await page.route('**/display-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('e2e/chat-display-harness.html');
}
const panel = (page: Page) => page.getByRole('complementary', { name: '文件更改详情' });
const summary = (page: Page) => page.getByRole('region', { name: '本轮修改', exact: true });
const update = (page: Page, value: Thread) => page.evaluate(detail =>
  window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);

test('keeps running edits in a compact pill and expands the summary only after completion', async ({ page }, info) => {
  const value = fixture();
  value.turns![0].status = 'inProgress';
  value.turns![0].items.push({ id: 'running', type: 'commandExecution', status: 'inProgress', command: 'npm test' });
  await open(page, value);
  const pill = page.locator('.chat-changes-pill');
  await expect(pill).toContainText('已编辑 5 个文件');
  await expect(pill).toContainText('+5−5');
  expect((await pill.boundingBox())!.height).toBeLessThan(45);
  expect((await pill.boundingBox())!.width).toBeLessThan(300);
  await expect(page.locator('.chat-turn-summary li, .chat-files-summary')).toHaveCount(0);
  await page.screenshot({ path: `../../.codex-tmp/web-running-edits-${info.project.name}.png` });
  await pill.click();
  if (info.project.name === 'mobile') await page.locator('.chat-diff-file summary').first().click();
  await expect(page.getByText('const newValue = 0;', { exact: false }).last()).toBeVisible();
  await page.getByRole('button', { name: /关闭详情抽屉|^关闭$/ }).last().click();
  value.turns![0].status = 'completed';
  await update(page, value);
  await expect(pill).toHaveCount(0);
  await expect(page.locator('.chat-turn-summary')).toContainText('已编辑');
  await expect(page.locator('.chat-turn-summary')).toContainText(paths[0]);
});

test('matches local summaries and opens a docked diff with file scope, split view and panel controls', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await open(page);
  await expect(summary(page)).toContainText('已编辑 5 个文件');
  await expect(summary(page).locator('li')).toHaveCount(3);
  await expect(summary(page).locator('li').first()).toContainText('+1−1');
  await summary(page).getByRole('button', { name: '再显示 2 个文件' }).click();
  await expect(summary(page).locator('li')).toHaveCount(5);
  await summary(page).getByRole('button', { name: '收起文件列表' }).click();
  const target = summary(page).getByRole('button', { name: `查看 ${paths[1]} 的差异`, exact: true });
  await target.click();
  await expect(panel(page)).toContainText('const newValue = 1;');
  await expect(panel(page)).not.toContainText(paths[0]);
  expect((await page.locator('.chat-conversation').boundingBox())!.width).toBeLessThan(1100);
  await expect(panel(page).locator('.hljs-keyword').first()).toContainText('const');
  await panel(page).getByRole('button', { name: '并排', exact: true }).click();
  await expect(panel(page).getByText('修改前', { exact: true })).toBeVisible();
  await page.getByRole('separator', { name: '调整详情抽屉宽度' }).press('ArrowLeft');
  await expect(panel(page)).toHaveCSS('width', '584px');
  await panel(page).getByRole('button', { name: '最小化详情抽屉' }).click();
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: '恢复文件更改' }).click();
  await panel(page).getByRole('button', { name: '展开详情抽屉' }).click();
  await expect(panel(page)).toHaveCSS('width', '1600px');
  await panel(page).getByRole('button', { name: '还原抽屉宽度' }).click();
  await panel(page).getByRole('button', { name: '关闭详情抽屉' }).click();
  await expect(target).toBeFocused();
  await summary(page).getByRole('button', { name: /^查看本轮修改：5 个文件/ }).click();
  await expect(panel(page)).toContainText('5 个文件');
  await panel(page).getByRole('button', { name: /^fifth\.ts/ }).click();
  await expect(panel(page)).toContainText(paths[4]);
  await page.screenshot({ path: '../../.codex-tmp/web-desktop-diff-parity.png' });
});

test('keeps the selected diff current and preserves the draft when switching to a narrow layout', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop');
  const value = fixture();
  await open(page, value);
  await summary(page).getByRole('button', { name: `查看 ${paths[0]} 的差异`, exact: true }).click();
  value.turns![0].items[1].changes![0].diff = '@@ -1 +1 @@\n-const oldValue = 0;\n+const streamedValue = 42;\n';
  await update(page, value);
  await expect(panel(page)).toContainText('const streamedValue = 42;');
  await expect(panel(page)).not.toContainText(paths[1]);
  await page.getByRole('textbox', { name: '消息' }).fill('Keep this draft');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: '查看本轮修改：5 个文件', exact: true }).click();
  await expect(page.locator('.ant-drawer-right .chat-diff')).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('.ant-drawer-right .chat-diff')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveValue('Keep this draft');
  await summary(page).getByRole('button', { name: `查看 ${paths[0]} 的差异`, exact: true }).click();
  await expect(panel(page)).toContainText('const streamedValue = 42;');
});

test('translates desktop diff controls without translating file paths or code', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop');
  await page.addInitScript(() => localStorage.setItem('codex-switch.web.language.v1', 'en'));
  await open(page);
  await page.getByRole('button', { name: 'View diff for src/first/index.ts', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'File change details' });
  await expect(details).toContainText('const newValue = 0;');
  await details.getByRole('button', { name: 'Side by side', exact: true }).click();
  await expect(details.getByText('Before', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('codex-switch.web.language.v1', 'zh');
    window.dispatchEvent(new StorageEvent('storage', { key: 'codex-switch.web.language.v1' }));
  });
  await expect(panel(page).getByText('修改前', { exact: true })).toBeVisible();
  await expect(panel(page)).toContainText('const newValue = 0;');
  await panel(page).getByRole('button', { name: '关闭详情抽屉' }).click();
});
