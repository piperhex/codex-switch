import { test, expect } from '@playwright/test';
import { titleBackend } from './thread-titles-backend';

for (const width of [390, 1280]) {
  test(`remote chat generates configured titles with the PC chat closed at ${width}px`, async ({ page }) => {
    const backend = titleBackend();
    await backend.attach(page.context());
    await page.setViewportSize({ width, height: 844 });
    try {
      await page.goto('/e2e/remote-titles-harness.html');
      await page.getByRole('textbox', { name: '聊天消息' }).fill('检查手机发出的聊天为什么没有生成标题');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect.poll(() => backend.titleRequests.length).toBe(1);
      expect(backend.titleRequests[0].settings).toEqual({ model: 'admin-title-model', effort: 'medium' });
      await expect(page.getByRole('status', { name: '回复状态' })).toHaveText('正在回复');
      const beats = Number(await page.getByLabel('刷新次数').textContent());
      await page.getByRole('textbox', { name: '聊天消息' }).fill('等待标题期间仍能输入');
      await expect.poll(async () => Number(await page.getByLabel('刷新次数').textContent())).toBeGreaterThan(beats);
      backend.finish('手机聊天标题修复');
      await expect(page.getByRole('button', { name: '手机聊天标题修复' })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(backend.reads()).toBe(1);
    } finally { backend.release(); }
  });
}

test('an older admin server still generates titles with Luna while chat and polling stay responsive', async ({ page }) => {
  const backend = titleBackend(404);
  await backend.attach(page.context());
  try {
    await page.goto('/e2e/thread-titles-harness.html');
    await page.getByRole('textbox', { name: '聊天消息' }).fill('这是一个标题自动生成的测试对话');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => backend.titleRequests.length).toBe(1);
    expect(backend.titleRequests[0].settings).toEqual({ model: 'gpt-5.6-luna', effort: 'low' });
    await expect(page.getByRole('status', { name: '回复状态' })).toHaveText('正在回复');
    const beats = Number(await page.getByLabel('刷新次数').textContent());
    await page.getByRole('textbox', { name: '聊天消息' }).fill('仍能输入');
    await expect.poll(async () => Number(await page.getByLabel('刷新次数').textContent())).toBeGreaterThan(beats);
    backend.finish('对话标题生成测试');
    await expect(page.getByRole('button', { name: '对话标题生成测试' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { backend.release(); }
});

test('titles follow admin settings and tab activations while replies and polling remain responsive', async ({ page }) => {
  const backend = titleBackend();
  await backend.attach(page.context());
  try {
    await page.goto('/e2e/thread-titles-harness.html');
    await expect.poll(backend.reads).toBe(1);
    await page.getByRole('textbox', { name: '聊天消息' }).fill('生成一个熊骑车的 SVG 动画');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => backend.titleRequests.length).toBe(1);
    expect(backend.titleRequests[0].settings).toEqual({ model: 'admin-title-model', effort: 'medium' });
    await expect(page.getByRole('status', { name: '回复状态' })).toHaveText('正在回复');
    await expect(page.getByRole('button', { name: '生成一个熊骑车的 SVG 动画' })).toBeVisible();
    const beats = Number(await page.getByLabel('刷新次数').textContent());
    await page.getByRole('textbox', { name: '聊天消息' }).fill('起名等待期间仍能输入');
    await expect.poll(async () => Number(await page.getByLabel('刷新次数').textContent())).toBeGreaterThan(beats);
    await expect(page.getByText('正在刷新用量')).toBeVisible();
    backend.finish('熊骑车 SVG 动画');
    await expect(page.getByRole('button', { name: '熊骑车 SVG 动画' })).toBeVisible();
    expect(backend.reads()).toBe(1);
    backend.configure({ model: 'next-model', effort: 'low' });
    await page.getByRole('button', { name: '离开 GUI' }).click();
    await page.getByRole('button', { name: '打开 GUI' }).click();
    await expect.poll(backend.reads).toBe(2);
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await page.getByRole('textbox', { name: '聊天消息' }).fill('第二个任务');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => backend.titleRequests.length).toBe(2);
    expect(backend.titleRequests[1].settings).toEqual({ model: 'next-model', effort: 'low' });
    backend.finish(null);
    await expect(page.getByRole('button', { name: '第二个任务' })).toBeVisible();
    await page.getByRole('button', { name: '熊骑车 SVG 动画' }).click();
    await expect(page.getByLabel('当前对话')).toHaveText('thread-1');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(backend.reads()).toBe(2);
  } finally { backend.release(); }
});
