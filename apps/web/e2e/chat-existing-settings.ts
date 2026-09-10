import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { click, fixtureUrl, screenshot, send, settled, state } from './chat-helpers';

async function choose(page: Page, field: string, value: string) {
  await click(page.getByRole('button', { name: `设置${field}`, exact: true }));
  const option = page.getByRole('radio', { name: value, exact: true });
  await expect(option).toBeEnabled();
  await click(option);
  await expect(page.getByRole('button', { name: `设置${field}`, exact: true })).toBeVisible();
}

export async function existingChatSettings({ page, request, info }: {
  page: Page; request: APIRequestContext; info: TestInfo;
}) {
  await send(page, 'slow task while editing settings');
  await expect(page.getByRole('button', { name: '停止回复' })).toBeVisible();
  await request.post(`${fixtureUrl}/test/settings-delay`, { data: { milliseconds: 5000 } });
  await click(page.getByRole('button', { name: /测试模型 · 高/ }));
  await choose(page, '推理强度', '极高');
  await expect(page.getByText('正在保存设置…', { exact: true })).toBeVisible();
  await choose(page, '模型', '第二模型');
  await choose(page, '推理强度', '极高');
  await choose(page, '访问权限', '请求批准');
  await screenshot(page, info, '09-existing-chat-settings-saving');
  // Two serialized saves deliberately wait five seconds each before acknowledging.
  await expect.poll(async () => (await state(request)).composer.settings, { timeout: 15_000 }).toEqual({
    model: 'second-model', effort: 'xhigh', access: 'read-only',
  });
  await expect(page.getByText('正在保存设置…', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await request.post(`${fixtureUrl}/test/settings-delay`, { data: { milliseconds: 0 } });
  await click(page.getByRole('button', { name: '完成', exact: true }));
  await click(page.getByRole('button', { name: '停止回复' }));
  await settled(page);
  await send(page, 'next message after editing existing settings');
  await settled(page);
  expect((await state(request)).operations.filter((entry) => entry.operation === 'send').at(-1))
    .toMatchObject({ threadId: 'demo-chat', model: 'second-model', effort: 'xhigh', access: 'read-only' });
}
