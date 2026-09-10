import { test, expect } from '@playwright/test';
import { connect, navigate, send, settled, screenshot, state, fixtureUrl } from './chat-helpers';
import { chatJourney } from './chat-journey';

test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await expect.poll(async () => (await state(request)).operations.length).toBe(0);
  await page.goto('./');
  await page.getByPlaceholder('name@example.com').fill('mobile-test@example.test');
  await page.getByPlaceholder('输入登录密码').fill('local-test');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
});


test('syncs PC chats over direct transport, supports actions and reconnects without duplicate sends',
  async ({ page, request }, info) => chatJourney({ page, request, info }));

test('keeps the PC chat after login renewal and disconnects on logout', async ({ page, request }) => {
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: '已直连' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '打开聊天列表' }).click();
  await page.getByRole('button', { name: /移动端聊天体验/ }).click();
  await navigate(page, '账号');
  await expect.poll(async () => (await state(request)).connectedMobiles).toBe(0);
  let expired = false;
  await page.route('**/auth/me', (route) => {
    if (expired) return route.continue();
    expired = true;
    return route.fulfill({ status: 401, json: {} });
  });
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/auth/refresh'));
  await navigate(page, '聊天');
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: '已直连' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: '移动端聊天体验', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-switch.web.session.v1') ?? '{}').accessToken))
    .toBe('renewed-test-token');
  await navigate(page, '设置');
  await page.locator('.settings-list').getByText('退出登录').click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录并查看' })).toBeVisible();
  await expect.poll(async () => (await state(request)).connectedMobiles).toBe(0);
});

test('falls back after direct discovery fails and keeps the composer within a smaller viewport',
  async ({ page, request }, info) => {
    await page.evaluate(() => {
      window.RTCPeerConnection = class {
        constructor() { throw new Error('Direct connection disabled for this regression'); }
      } as unknown as typeof RTCPeerConnection;
    });
    const started = Date.now();
    await connect(page);
    await expect(page.getByRole('status').filter({ hasText: '通过服务器连接' })).toBeVisible({ timeout: 16_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(10_000);
    await page.getByRole('button', { name: '打开聊天列表' }).click();
    await page.getByRole('button', { name: /移动端聊天体验/ }).click();
    await send(page, 'encrypted relay from H5');
    await settled(page);
    await page.setViewportSize({ width: 390, height: 480 });
    await page.getByRole('textbox', { name: '聊天消息' }).focus();
    const bounds = await page.getByRole('button', { name: '发送消息' }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
    expect((await state(request)).relayFrames).toBeGreaterThan(0);
    await screenshot(page, info, '04-short-viewport');
  });
