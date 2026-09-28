import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { connect, fixtureUrl, navigate, openChatList, state } from './chat-helpers';

async function visibility(page: Page, visible: boolean) {
  await page.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, value: visible ? 'visible' : 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent(visible ? 'pageshow' : 'pagehide', { persisted: true }));
  }, visible);
}

async function sameConnection(request: APIRequestContext, connections: number) {
  const current = await state(request);
  expect(current.connectedMobiles).toBe(1);
  expect(current.mobileConnections).toBe(connections);
  expect(current.errors).toEqual([]);
  expect(current.streamErrors).toEqual([]);
}

async function completeInBackground(page: Page, request: APIRequestContext) {
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'start' } });
  await expect(page.locator('.chat-processing-status')).toHaveCount(1);
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'complete' } });
  await expect(page.locator('.chat-processing-status')).toHaveCount(0);
  await expect.poll(async () => (await state(request)).sidebar.readState['demo-chat']?.unread).toBe(true);
}

async function browserBackground(page: Page, request: APIRequestContext, connections: number) {
  await request.post(`${fixtureUrl}/test/history-delay`, { data: { milliseconds: 1000 } });
  await openChatList(page);
  await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '正在加载聊天记录' })).toBeVisible();
  await visibility(page, false);
  // The history response already in flight must still arrive on the original session.
  await expect(page.getByText('帮我整理今天的工作计划。')).toBeVisible();
  await request.post(`${fixtureUrl}/test/history-delay`, { data: { milliseconds: 0 } });
  await completeInBackground(page, request);
  await sameConnection(request, connections);
  await visibility(page, true);
  await expect.poll(async () => (await state(request)).sidebar.readState['demo-chat']?.unread).toBe(false);
  await sameConnection(request, connections);
}

async function internalPages(page: Page, request: APIRequestContext, connections: number) {
  await page.getByRole('textbox', { name: '聊天消息' }).fill('切回来继续编辑');
  for (const label of ['账号', '设置']) {
    await navigate(page, label);
    await completeInBackground(page, request);
    await sameConnection(request, connections);
    await navigate(page, '聊天');
    await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveValue('切回来继续编辑');
    await expect.poll(async () => (await state(request)).sidebar.readState['demo-chat']?.unread).toBe(false);
    await sameConnection(request, connections);
  }
}

export async function backgroundJourney(page: Page, request: APIRequestContext, relay: boolean) {
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: relay ? 'Relay' : 'P2P' }))
    .toBeVisible({ timeout: 16_000 });
  const connections = (await state(request)).mobileConnections;
  await browserBackground(page, request, connections);
  await internalPages(page, request, connections);
  await visibility(page, false);
  await request.post(`${fixtureUrl}/test/disconnect`);
  await expect.poll(async () => (await state(request)).mobileConnections).toBe(connections + 1);
  await expect(page.getByRole('status').filter({ hasText: relay ? 'Relay' : 'P2P' }))
    .toBeVisible({ timeout: 16_000 });
  await visibility(page, true);
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveValue('切回来继续编辑');
  await sameConnection(request, connections + 1);
}
