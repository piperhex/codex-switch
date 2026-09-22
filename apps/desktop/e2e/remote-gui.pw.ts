import { createRequire } from 'node:module';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import type { WebSocketServer as Server } from 'ws';
import type { AddressInfo } from 'node:net';
import type { ChatSessions as Sessions } from '../../admin/src/modules/devices/chat/chat-sessions';
import type { ChatIdentity } from '../../admin/src/modules/devices/chat/protocol';
import './chat-harness-types';

const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(new URL('../../admin/package.json', import.meta.url))('ws') as {
  WebSocketServer: typeof Server;
};
const { ChatSessions } = require('../../admin/dist/modules/devices/chat/chat-sessions.js') as { ChatSessions: typeof Sessions };
let server: Server;
let endpoint: string;

test.beforeEach(async () => {
  const sessions = new ChatSessions();
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('connection', socket => {
    let joined = false;
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString());
      if (joined) { sessions.route(socket, frame); return; }
      joined = true;
      const identity: ChatIdentity = { role: frame.role, deviceId: frame.deviceId, ownerId: 'owner',
        expiresAt: Date.now() + 300_000 };
      sessions.join(socket, identity, frame, []);
    });
    socket.on('close', () => sessions.disconnect(socket));
  });
});
test.afterEach(async () => {
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function chooseComputer(page: Page, name: string) {
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: '切换电脑', exact: true }).click();
  await page.getByRole('region', { name: '电脑列表' }).getByRole('button', { name: new RegExp(name) }).click();
}

test('switches desktop GUI conversations and accounts between computers and back to local', async ({ context, page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const office = await context.newPage();
  const home = await context.newPage();
  for (const [host, device, title] of [[office, 'computer-one', 'Office conversation'],
    [home, 'computer-two', 'Home conversation']] as const) {
    await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=${device}`
      + `&title=${encodeURIComponent(title)}&socket=${encodeURIComponent(endpoint)}`);
    await expect(host.locator('#status')).toHaveText('registered');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseComputer(page, 'Office PC');
  await expect(page.getByRole('button', { name: 'Office conversation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Office conversation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '聊天消息', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Continue on the office computer');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'send'))).toBe(true);
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: '切换账户', exact: true }).click();
  await page.getByRole('button', { name: /演示账户二/ }).click();
  await expect(page.getByRole('button', { name: '切换 GUI 账户：演示账户二', exact: true })).toBeVisible();
  expect(await home.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'guiAccountSelect'))).toBe(false);
  await chooseComputer(page, 'Home PC');
  await expect(page.getByRole('button', { name: 'Home conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Office conversation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '切换 GUI 账户：演示账户一', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../.codex-tmp/gui-remote-home.png' });
  await chooseComputer(page, '本机');
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
  expect(errors).toEqual([]);
});

test('keeps secondary menus compact and responsive during slow discovery and a failed connection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  const before = await page.evaluate(() => window.remoteGuiFixture.beats());
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: '切换电脑', exact: true }).click();
  await expect(page.getByRole('button', { name: /Offline PC/ })).toBeDisabled();
  await page.evaluate(() => window.remoteGuiFixture.pauseDirectory());
  await page.getByRole('button', { name: '刷新电脑列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新电脑列表', exact: true })).toBeDisabled();
  await page.screenshot({ path: '../../.codex-tmp/gui-computer-menu-narrow.png' });
  await page.getByRole('button', { name: '返回账户与电脑', exact: true }).click();
  await page.getByRole('button', { name: '切换账户', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索账号或 Provider', exact: true });
  await search.fill('alex'); await search.press('ArrowLeft');
  await expect(search).toBeVisible(); await expect(search).toHaveValue('alex');
  await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(before + 4);
  const bounds = (await page.locator('.ant-popover:visible').boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(400);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '../../.codex-tmp/gui-account-submenu-narrow.png' });
  await page.evaluate(() => window.remoteGuiFixture.releaseDirectory());
  await search.press('Escape');
  await chooseComputer(page, 'Office PC');
  await expect(page.getByRole('region', { name: 'Codex GUI：Office PC' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveCount(0);
  await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
  await chooseComputer(page, '本机');
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
});
