import { expect, test } from '@playwright/test';
import { connect, fixtureUrl, login, openChatList, screenshot, state } from './chat-helpers';

test('reviews task changes with versioned checks, comments, restore preview and PR status', async ({ page, request }, info) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'message-details' } });
  await login(page); await connect(page); await openChatList(page);
  await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
  await page.getByRole('button', { name: '验收结果', exact: true }).first().click();
  const panel = page.locator('.chat-review-panel');
  await expect(panel.locator('[data-check-status="notRun"]')).toHaveCount(3, { timeout: 15_000 });
  await panel.getByRole('button', { name: '运行验证', exact: true }).last().click();
  await panel.getByRole('button', { name: '确认运行验证', exact: true }).click();
  await expect(panel.locator('[data-check-status="passed"]')).toHaveCount(1, { timeout: 12_000 });
  await request.post(`${fixtureUrl}/test/task-review`, { data: { changed: true } });
  await panel.getByRole('button', { name: '刷新验收结果', exact: true }).click();
  await expect(panel.locator('[data-check-status="stale"]')).toHaveCount(1);
  await screenshot(page, info, 'review-stale-check');
  await request.post(`${fixtureUrl}/test/task-review`, { data: { conflict: true } });
  await panel.getByRole('button', { name: '预览恢复影响' }).click();
  await expect(panel.getByRole('button', { name: '确认恢复本轮修改' })).toBeDisabled();
  await expect(panel.getByText('文件已有其他修改，无法安全恢复。请先审核差异。')).toBeVisible();
  await screenshot(page, info, 'review-restore-conflict');
  await panel.getByRole('button', { name: '刷新 PR 与 CI' }).click();
  await expect(panel.getByText('当前分支还没有打开的 PR。')).toBeVisible();
  await panel.getByRole('button', { name: '创建草稿 PR', exact: true }).click();
  await panel.getByLabel('PR 标题', { exact: true }).fill('Review from phone');
  await panel.getByRole('button', { name: '确认创建草稿 PR' }).click();
  await expect(panel.getByRole('link', { name: '#42 Review from phone' })).toBeVisible();
  await expect(panel.getByText('unit-tests：SUCCESS')).toBeVisible();
  const file = panel.locator('.chat-diff-file').first();
  await file.locator('summary').click();
  await file.getByRole('button', { name: /对第 .* 行留言/ }).last().click();
  const comment = page.locator('.chat-review-form').filter({ has: page.getByRole('textbox', { name: '修改意见' }) });
  await comment.getByRole('textbox', { name: '修改意见' }).fill('请补充边界检查');
  await comment.getByRole('button', { name: '发送到原会话' }).click();
  await expect(comment).toHaveCount(0);
  await expect.poll(async () => (await state(request)).operations
    .filter(row => ['send', 'queueEnqueue'].includes(String(row.operation)))
    .some(row => JSON.stringify(row).includes('验收意见：\\n请补充边界检查'))).toBe(true);
  await page.getByRole('dialog').filter({ has: panel }).getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '打开工具', exact: true }).click();
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Git', exact: true })).toBeVisible();
});
