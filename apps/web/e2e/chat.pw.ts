import { test, expect } from '@playwright/test';
import { connect, navigate, send, settled, screenshot, state, fixtureUrl, openChatSettings } from './chat-helpers';
import { chatJourney } from './chat-journey';
import { historyJourney } from './chat-history';
import { attachmentJourney } from './chat-attachments';
import { composerLayout } from './chat-composer';
import { projectPickerJourney } from './chat-project-picker';

test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await expect.poll(async () => (await state(request)).operations.length).toBe(0);
  await page.goto('./');
  await page.getByPlaceholder('name@example.com').fill('mobile-test@example.test');
  await page.getByPlaceholder('输入登录密码').fill('local-test');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
});


test('keeps composer icons below single and multiline drafts', async ({ page }) => composerLayout(page));

test('syncs request speed with the PC and shows a lightning indicator only in fast mode', async ({ page, request }) => {
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ })).toBeVisible({ timeout: 16_000 });
  await openChatSettings(page);
  await page.getByRole('button', { name: '设置速度模式', exact: true }).click();
  await page.getByRole('radio', { name: '快速模式', exact: true }).click();
  await expect.poll(async () => (await state(request)).composer.settings.speed).toBe('fast');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息' }).focus();
  await page.evaluate(() => {
    // This web composer shows its model control while the keyboard is open.
    if (!window.visualViewport) throw new Error('Visual viewport is required');
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => innerHeight - 300 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  const settings = page.getByRole('button', { name: /聊天设置/ });
  await expect(settings).toContainText('⚡');
  await request.post(`${fixtureUrl}/test/composer`, { data: { speed: 'normal' } });
  await expect(settings).not.toContainText('⚡');
  await openChatSettings(page);
  await expect(page.getByRole('button', { name: '设置速度模式', exact: true })).toContainText('普通模式');
});

test('syncs PC chats over direct transport, supports actions and reconnects without duplicate sends',
  async ({ page, request }, info) => chatJourney({ page, request, info }));

for (const relay of [false, true]) {
  test(`selects a computer folder for a new chat over ${relay ? 'relay' : 'direct'}`,
    async ({ page, request }) => projectPickerJourney({ page, request, relay }));
  test(`sends album photos over ${relay ? 'relay' : 'direct'}`,
    async ({ page, request }, info) => attachmentJourney({ page, request, info, relay }));
  test(`pages history and streams with a processing timer over ${relay ? 'relay' : 'direct'}`,
    async ({ page, request }, info) => historyJourney({ page, request, info, relay }));
}

test('keeps the PC chat after login renewal and disconnects on logout', async ({ page, request }) => {
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 15_000 });
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
  await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByRole('status').filter({ hasText: 'Relay' })).toBeVisible({ timeout: 16_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(10_000);
    await page.getByRole('button', { name: '打开聊天列表' }).click();
    await page.getByRole('button', { name: /移动端聊天体验/ }).click();
    await send(page, 'encrypted relay from H5');
    await settled(page);
    await page.setViewportSize({ width: 390, height: 480 });
    await page.getByRole('textbox', { name: '聊天消息' }).focus();
    const bounds = await page.getByRole('button', { name: '添加内容', exact: true }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
    expect((await state(request)).relayFrames).toBeGreaterThan(0);
    await screenshot(page, info, '04-short-viewport');
  });
