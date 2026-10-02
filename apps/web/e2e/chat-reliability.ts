import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { connect, send, settled, screenshot, fixtureUrl } from './chat-helpers';

export async function reliabilityJourney(page: Page, request: APIRequestContext, info: TestInfo) {
  await connect(page);
  await expect(page.locator('.chat-task-status')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ })).toBeVisible({ timeout: 16_000 });
  await expect(page.locator('.chat-header').getByText('连接体检', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^(P2P|Relay) · 连接体检$/ }).click();
  await expect(page.getByText('账号登录 · 正常', { exact: true })).toBeVisible();
  await expect(page.getByText('电脑在线 · 正常', { exact: true })).toBeVisible();
  await expect(page.getByText('电脑聊天 · 正常', { exact: true })).toBeVisible();
  const relay = info.title.endsWith('over relay');
  await expect(page.getByText(relay ? '已通过中转连接' : '已直连电脑', { exact: true })).toBeVisible();
  const panel = page.getByText('账号登录 · 正常', { exact: true }).locator('..').locator('..').locator('..');
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(400);
  await screenshot(page, info, 'connection-health');
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await send(page, 'approval accept');
  await expect(page.getByRole('button', { name: '允许这一次' })).toBeVisible();
  await expect(page.locator('.chat-task-status')).toHaveCount(0);
  await page.getByRole('button', { name: '允许这一次' }).click();
  await settled(page);
  await expect(page.locator('.chat-task-status')).toHaveCount(0);
  await screenshot(page, info, 'result-ready');
  await send(page, 'approval accept again');
  await expect(page.getByRole('button', { name: '允许这一次' })).toBeVisible();
  await expect(page.locator('.chat-task-status')).toHaveCount(0);
  await request.post(`${fixtureUrl}/test/connection-block`, { data: { blocked: true } });
  try {
    await expect(page.locator('.chat-task-status')).toContainText('任务状态待更新');
    await page.locator('.chat-connection-status').click();
    await expect(page.getByText('连接线路 · 待确认', { exact: true })).toBeVisible();
    await screenshot(page, info, 'connection-recovery');
    await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  } finally {
    await request.post(`${fixtureUrl}/test/connection-block`, { data: { blocked: false } });
  }
  await expect(page.getByRole('button', { name: '允许这一次' })).toBeEnabled({ timeout: 40_000 });
  await expect(page.locator('.chat-task-status')).toHaveCount(0);
  await page.getByRole('button', { name: '允许这一次' }).click();
  await settled(page);
  await expect(page.locator('.chat-task-status')).toHaveCount(0);
}
