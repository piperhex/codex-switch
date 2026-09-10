import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { connect, fixtureUrl, screenshot, state } from './chat-helpers';

export async function historyJourney({ page, request, info, relay }: {
  page: Page; request: APIRequestContext; info: TestInfo; relay: boolean;
}) {
  if (relay) await page.evaluate(() => {
    window.RTCPeerConnection = class {
      constructor() { throw new Error('Direct transport disabled for the relay regression'); }
    } as unknown as typeof RTCPeerConnection;
  });
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: relay ? '通过服务器连接' : '已直连' }))
    .toBeVisible({ timeout: 16_000 });
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'history-pages' } });
  await request.post(`${fixtureUrl}/test/history-delay`, { data: { milliseconds: 600 } });
  await page.getByRole('button', { name: '打开聊天列表' }).click();
  await page.getByRole('button', { name: /移动端聊天体验/ }).click();
  const items = page.locator('[data-message-id]');
  await expect(items).toHaveCount(10);
  await expect(items.first()).toHaveAttribute('data-message-id', 'history-26');
  for (const count of [20, 30, 35]) {
    const first = items.first();
    const id = await first.getAttribute('data-message-id');
    await page.locator('.chat-messages').evaluate((node) => { node.scrollTop = 0; });
    await expect(page.getByRole('status').filter({ hasText: '正在加载聊天记录' })).toBeVisible();
    const top = (await first.boundingBox())!.y;
    await expect(items).toHaveCount(count);
    const preserved = page.locator(`[data-message-id="${id}"]`);
    await expect.poll(async () => Math.abs((await preserved.boundingBox())!.y - top)).toBeLessThan(3);
  }
  await expect(page.getByRole('button', { name: '加载更早的消息' })).toHaveCount(0);
  await request.post(`${fixtureUrl}/test/history-delay`, { data: { milliseconds: 0 } });
  await page.locator('.chat-messages').evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'start' } });
  await expect(page.getByRole('button', { name: '暂停生成' })).toBeVisible();
  const processing = page.getByRole('status').filter({ hasText: '正在处理' });
  await expect(processing).toContainText(/正在处理 · [2-9]秒/, { timeout: 10_000 });
  const response = items.last();
  await expect(response).toContainText('处理中…');
  const firstText = await response.textContent();
  await expect.poll(() => response.textContent()).not.toBe(firstText);
  expect((await state(request)).threads.find((thread) => thread.id === 'demo-chat')?.turns?.at(-1)?.status)
    .toBe('inProgress');
  await screenshot(page, info, `history-stream-${relay ? 'relay' : 'direct'}`);
  await page.locator('.chat-messages').evaluate((node) => { node.scrollTop = 0; });
  await expect(processing).toBeVisible();
  await page.getByRole('button', { name: '暂停生成' }).click();
  await expect(processing).toHaveCount(0);
  expect((await state(request)).streamErrors).toEqual([]);
}
