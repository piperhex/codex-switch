import { test, expect } from '@playwright/test';
import { openChatList, connect, navigate, send, settled, screenshot, state, fixtureUrl, openChatSettings } from './chat-helpers';
import { chatJourney } from './chat-journey';
import { historyJourney } from './chat-history';
import { attachmentJourney } from './chat-attachments';
import { imageEditorJourney } from './chat-image-editor';
import { composerLayout, desktopComposer } from './chat-composer';
import { projectPickerJourney } from './chat-project-picker';
import { clipboardJourney } from './chat-clipboard';
import { backgroundJourney } from './chat-background';
import { modelPickerJourney } from './chat-model-picker';

test.beforeEach(async ({ page, request }, info) => {
  // Login can open chat immediately; install the network fault before any peer is created.
  if (info.title.endsWith('over relay') || info.title.startsWith('falls back after direct discovery')) {
    await page.addInitScript(() => {
      window.RTCPeerConnection = class {
        constructor() { throw new Error('Direct transport disabled for the relay regression'); }
      } as unknown as typeof RTCPeerConnection;
    });
  }
  await request.post(`${fixtureUrl}/test/reset`);
  await expect.poll(async () => (await state(request)).operations.length).toBe(0);
  await page.goto('./');
  await page.getByPlaceholder('name@example.com').fill('mobile-test@example.test');
  await page.getByPlaceholder('输入登录密码').fill('local-test');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '同意并登录' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  // The shell appears before sign-in finishes loading dashboard data; reloading then cancels login.
  await expect(page.getByText('欢迎回来', { exact: true })).toBeVisible();
});


test('keeps composer icons below single and multiline drafts', async ({ page }) => composerLayout(page));
test('uses the PC model picker and keeps the mobile settings unchanged', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop model picker interaction');
  await modelPickerJourney(page, request, info);
});
test('uses desktop composer controls and Enter shortcuts while streaming', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop composer interaction');
  await desktopComposer(page, request, info);
});
test('pastes text, images and files without replacing the draft',
  async ({ page, request }) => clipboardJourney(page, request));

test('annotates photos before sending and preserves cancelled edits',
  async ({ page, request }, info) => imageEditorJourney({ page, request, info }));

for (const [code, message] of [[4004, '电脑的聊天连接尚未就绪。'], [4008, '这台电脑的聊天连接数已满，']] as const) {
  test(`explains connection failure ${code} in a compact message and recovers`, async ({ page }, info) => {
    let rejectConnection = true;
    await page.routeWebSocket('**/device-chat', (socket) => {
      if (!rejectConnection) { socket.connectToServer(); return; }
      socket.onMessage(() => socket.close({ code, reason: 'Private server details must not be displayed' }));
    });
    // Login opens chat immediately, so recreate that socket after installing the failure route.
    await page.reload();
    await connect(page);
    const alert = page.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('连接未完成');
    const box = await alert.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(400);
    await screenshot(page, info, `connection-failure-${code}`);
    rejectConnection = false;
    await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ })).toBeVisible({ timeout: 20_000 });
    await expect(alert).toHaveCount(0);
  });
}

test('syncs request speed with the PC and shows a lightning indicator only in fast mode', async ({ page, request }) => {
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ })).toBeVisible({ timeout: 16_000 });
  if (page.viewportSize()!.width > 860) {
    const speed = page.getByRole('switch', { name: '快速模式' });
    await speed.click();
    await expect.poll(async () => (await state(request)).composer.settings.speed).toBe('fast');
    await expect(speed).toBeChecked();
    await request.post(`${fixtureUrl}/test/composer`, { data: { speed: 'normal' } });
    await expect(speed).not.toBeChecked();
    return;
  }
  await openChatSettings(page);
  await page.getByRole('button', { name: '设置速度模式', exact: true }).click();
  await page.getByRole('radio', { name: '快速模式', exact: true }).click();
  await expect.poll(async () => (await state(request)).composer.settings.speed).toBe('fast');
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('textbox', { name: '聊天消息' }).focus();
  await page.evaluate(() => {
    // This web composer shows its model control while the keyboard is open.
    if (!window.visualViewport) throw new Error('Visual viewport is required');
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => innerHeight - 300 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  const settings = page.getByRole('button', { name: /聊天设置/ });
  await expect(settings).toHaveAccessibleName(/快速模式/);
  await request.post(`${fixtureUrl}/test/composer`, { data: { speed: 'normal' } });
  await expect(settings).not.toHaveAccessibleName(/快速模式/);
  await openChatSettings(page);
  await expect(page.getByRole('button', { name: '设置速度模式', exact: true })).toContainText('普通模式');
});

test('syncs PC chats over direct transport, supports actions and reconnects without duplicate sends',
  async ({ page, request }, info) => chatJourney({ page, request, info }));

for (const relay of [false, true]) {
  test(`keeps chat connected across browser tabs and app pages over ${relay ? 'relay' : 'direct'}`,
    async ({ page, request }) => backgroundJourney(page, request, relay));
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
  await openChatList(page);
  await page.getByRole('button', { name: /移动端聊天体验/ }).click();
  await navigate(page, '账号');
  await expect.poll(async () => (await state(request)).connectedMobiles).toBe(1);
  let expired = false;
  await page.route('**/auth/me', (route) => {
    if (expired) return route.continue();
    expired = true;
    return route.fulfill({ status: 401, json: {} });
  });
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/auth/refresh'));
  await request.post(`${fixtureUrl}/test/disconnect`);
  await navigate(page, '聊天');
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: '移动端聊天体验', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-switch.web.session.v1') ?? '{}').accessToken))
    .toBe('renewed-test-token');
  await navigate(page, '设置');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('.adm-dialog').getByRole('button', { name: '退出登录', exact: true }).click();
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
    await openChatList(page);
    await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
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
