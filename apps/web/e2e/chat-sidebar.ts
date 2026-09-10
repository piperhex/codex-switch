import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { click, fixtureUrl, screenshot, state } from './chat-helpers';

export async function sidebarJourney({ page, request, info }: {
  page: Page; request: APIRequestContext; info: TestInfo;
}) {
  const change = (action: string) => request.post(`${fixtureUrl}/test/sidebar`, { data: { action } });
  await click(page.getByRole('button', { name: '打开聊天列表' }));
  const drawer = page.locator('.chat-drawer');
  await expect(drawer.getByRole('region', { name: '演示项目' })).toBeVisible();
  await expect(drawer.getByRole('region', { name: '最近', exact: true })).toBeVisible();
  const row = drawer.getByRole('button', { name: '移动端聊天体验', exact: true });
  await expect(row).toHaveText('移动端聊天体验');
  await change('start');
  await expect(row.getByLabel('正在回复')).toBeVisible();
  await screenshot(page, info, '07-project-drawer-running');
  await change('complete');
  await expect(row.getByLabel('未读回复')).toBeVisible();
  await expect(row.getByLabel('正在回复')).toHaveCount(0);
  await screenshot(page, info, '08-project-drawer-unread');
  await change('read');
  await expect(row.getByLabel('未读回复')).toHaveCount(0);
  await change('start');
  await change('complete');
  await expect(row.getByLabel('未读回复')).toBeVisible();
  await click(row);
  await expect(page.getByRole('textbox', { name: '搜索聊天' })).toHaveCount(0);
  await expect.poll(async () => (await state(request)).sidebar.readState['demo-chat']?.unread).toBe(false);
  await click(page.getByRole('button', { name: '打开聊天列表' }));
  await expect(row.getByLabel('未读回复')).toHaveCount(0);
  await click(drawer.getByRole('button', { name: '新聊天', exact: true }));
  await expect(page.getByRole('heading', { name: '新聊天', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toBeEmpty();
}
