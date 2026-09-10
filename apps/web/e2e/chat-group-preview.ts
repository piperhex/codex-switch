import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { click, fixtureUrl, screenshot } from './chat-helpers';

export async function groupPreviewJourney({ page, request, info }: {
  page: Page; request: APIRequestContext; info: TestInfo;
}) {
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'group-preview' } });
  await click(page.getByRole('button', { name: '打开聊天列表' }));
  const drawer = page.locator('.chat-drawer');
  const project = drawer.getByRole('region', { name: '演示项目', exact: true });
  const recent = drawer.getByRole('region', { name: '最近', exact: true });
  const five = drawer.getByRole('region', { name: '五条项目', exact: true });
  for (const group of [project, recent, five]) await expect(group.locator('.chat-thread')).toHaveCount(5);
  await expect(five.getByRole('button', { name: /展开显示/ })).toHaveCount(0);
  await click(project.getByRole('button', { name: '展开显示：演示项目' }));
  await expect(project.locator('.chat-thread')).toHaveCount(6);
  await expect(recent.locator('.chat-thread')).toHaveCount(5);
  await click(project.getByRole('button', { name: '收起：演示项目' }));
  await expect(project.locator('.chat-thread')).toHaveCount(5);
  await screenshot(page, info, '10-folded-project-groups');
  await click(project.getByRole('button', { name: '展开显示：演示项目' }));
  await click(project.getByRole('button', { name: '移动端聊天体验', exact: true }));
  await click(page.getByRole('button', { name: '打开聊天列表' }));
  await expect(project.locator('.chat-thread')).toHaveCount(5);
  await expect(project.getByRole('button', { name: '移动端聊天体验', exact: true })).toBeVisible();
  await drawer.getByRole('textbox', { name: '搜索聊天' }).fill('聊天');
  await click(drawer.getByRole('button', { name: '搜索', exact: true }));
  await expect(project.locator('.chat-thread')).toHaveCount(6);
  await expect(project.getByRole('button', { name: /展开显示|收起/ })).toHaveCount(0);
}
