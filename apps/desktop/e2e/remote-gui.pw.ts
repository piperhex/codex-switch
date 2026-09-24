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
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await page.getByRole('region', { name: '设备列表' }).getByRole('button', { name: new RegExp(name) }).click();
}

for (const blocked of [false, true]) {
  test(`remote desktop tools use the selected computer over ${blocked ? 'Relay' : 'P2P'}`, async ({ context, page }) => {
    test.setTimeout(90_000);
    const office = await context.newPage();
    await office.goto(`/e2e/chat-harness.html?role=desktop&demo&device=computer-one&title=Office`
      + `&blocked=${blocked}&socket=${encodeURIComponent(endpoint)}`);
    await expect(office.locator('#status')).toHaveText('registered');
    await office.evaluate(() => {
      window.chatTest.demoState().threads[0].turns![0].diff =
        'diff --git a/remote.txt b/remote.txt\n--- a/remote.txt\n+++ b/remote.txt\n@@ -1 +1 @@\n-before\n+remote edit\n';
    });
    await page.bringToFront();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
    await chooseComputer(page, 'Office PC');
    await page.getByRole('button', { name: 'Office', exact: true }).click();
    await expect(page.locator('.chat-connection')).toContainText(blocked ? 'Relay' : 'P2P');
    await expect(page.getByRole('button', { name: '远程 Codex CLI 更新' })).toContainText('0.155.0');
    await page.getByRole('button', { name: '重新连接远程 Codex' }).click();
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .some(operation => operation.operation === 'guiReconnect'))).toBe(true);
    await page.getByRole('button', { name: '查看文件更改' }).click();
    const details = page.getByRole('complementary', { name: '文件更改详情' });
    await expect(details).toContainText('remote edit');
    await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    const summary = page.getByRole('region', { name: '本轮修改', exact: true });
    await expect(summary).toContainText('已编辑 1 个文件');
    await expect(summary.locator('li')).toContainText('+1−1');
    await summary.getByRole('button', { name: '查看 remote.txt 的差异', exact: true }).click();
    await details.getByRole('button', { name: '并排', exact: true }).click();
    await expect(details.getByText('修改前', { exact: true })).toBeVisible();
    await expect(details).toContainText('remote edit');
    await expect(page.locator('.chat-diff-workspace')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `../../.codex-tmp/gui-remote-diff-${blocked ? 'relay' : 'p2p'}.png` });
    await page.getByRole('button', { name: '关闭详情抽屉' }).click();
    await page.getByRole('button', { name: '打开远程终端' }).click();
    await expect(page.getByRole('region', { name: '终端', exact: true })).toBeVisible();
    const terminal = page.locator('.xterm-helper-textarea');
    await terminal.fill('echo remote');
    await terminal.press('Enter');
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .filter(operation => operation.operation === 'guiTerminalWrite').map(operation => operation.data).join('')))
      .toContain('echo remote');
    await page.getByRole('button', { name: '远程 Codex CLI 更新' }).click();
    await page.getByRole('button', { name: '检查版本', exact: true }).click();
    await page.getByRole('button', { name: '更新到 0.156.0' }).click();
    await expect(page.getByText('正在下载 Codex…')).toBeVisible();
    const beats = await page.evaluate(() => window.remoteGuiFixture.beats());
    await page.getByRole('button', { name: '远程 Codex CLI 更新' }).click();
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Draft while remote tools are active');
    await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(beats + 5);
    await expect(page.getByRole('button', { name: '远程 Codex CLI 更新' })).toContainText('0.156.0');
    await page.screenshot({ path: `../../.codex-tmp/gui-remote-tools-${blocked ? 'relay' : 'p2p'}.png` });
    await page.getByRole('button', { name: '关闭终端 1', exact: true }).click();
    await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
      .some(operation => operation.operation === 'guiTerminalClose'))).toBe(true);
    await chooseComputer(page, '本机');
    expect(await page.evaluate(() => window.remoteGuiFixture.commands
      .filter(command => /codex_gui_(cli_|terminal_|connect$|file_)/.test(command)))).toEqual([]);
  });
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
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseComputer(page, 'Office PC');
  await expect(page.getByRole('button', { name: 'Office conversation', exact: true })).toBeVisible();
  const quota = page.getByRole('progressbar', { name: '主用量剩余', exact: true });
  await expect(quota).toHaveAttribute('aria-valuenow', '28');
  await expect(quota).toBeVisible();
  await expect(page.getByRole('button', { name: /^切换 GUI 账户：/ })).toContainText('pro');
  await page.getByRole('button', { name: 'Office conversation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '聊天消息', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Continue slow task on the office computer');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'send'))).toBe(true);
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: /演示账户二/ }).click();
  await expect(page.getByRole('button', { name: '切换 GUI 账户：演示账户二', exact: true })).toBeVisible();
  await expect(quota).toHaveAttribute('aria-valuenow', '83');
  expect(await home.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'guiAccountSelect'))).toBe(false);
  await chooseComputer(page, 'Home PC');
  await expect(page.getByRole('button', { name: 'Home conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Office conversation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '切换 GUI 账户：演示账户一', exact: true })).toBeVisible();
  await expect(quota).toHaveAttribute('aria-valuenow', '28');
  expect(await office.evaluate(() => window.chatTest.demoState().threads
    .some(thread => thread.turns?.some(turn => turn.status === 'inProgress')))).toBe(true);
  expect(await office.evaluate(() => window.chatTest.demoState().operations
    .some(operation => operation.operation === 'interrupt'))).toBe(false);
  await page.screenshot({ path: '../../.codex-tmp/gui-remote-home.png' });
  await chooseComputer(page, '本机');
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
  expect(errors).toEqual([]);
});

test('matches local GUI layout and sends pasted images over Relay under the desktop image policy', async ({ context, page }) => {
  test.setTimeout(90_000);
  const office = await context.newPage();
  await office.goto(`/e2e/chat-harness.html?role=desktop&demo&blocked=true&device=computer-one`
    + `&title=Office&socket=${encodeURIComponent(endpoint)}`);
  await expect(office.locator('#status')).toHaveText('registered');
  // The simulated host opens a second tab; keep the tested UI visible so menu animations can finish.
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseComputer(page, 'Office PC');
  await page.getByRole('button', { name: 'Office', exact: true }).click();
  await expect(page.locator('.chat-connection')).toContainText('Relay');
  await expect(page.locator('.gui-remote-workspace')).toHaveAttribute('data-dream-skin', 'true');
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeVisible();
  await expect(page.getByText('最近', { exact: true })).toBeVisible();
  await expect(page.getByText('已归档', { exact: true })).toBeVisible();
  expect((await page.locator('.chat-sidebar').boundingBox())!.width).toBe(236);
  expect((await page.locator('.chat-header').boundingBox())!.height).toBe(38);
  await expect(page.locator('.chat-conversation')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => {
    window.remoteGuiFixture.setFontSize(16);
    window.dispatchEvent(new CustomEvent('codex-switch:dream-skin-status-changed', { detail: {
      installed: true, session: 'running', activeThemeId: 'fixture', activeThemeAppearance: 'dark',
      activeThemeOverlayOpacity: 0.85,
    } }));
  });
  await expect(page.locator('.chat-message-region')).toHaveCSS('color', 'rgb(230, 232, 235)');
  await expect(page.locator('.chat-markdown').first()).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: '访问权限：帮我批准', exact: true }).click();
  await expect(page.locator('.chat-composer-access-menu')).toBeVisible();
  await expect(page.locator('.ant-popover:visible')).toHaveCSS('opacity', '1');
  await expect(page.locator('.chat-composer-access-menu')).toHaveCSS('color', 'rgb(230, 232, 235)');
  await page.screenshot({ path: '../../.codex-tmp/gui-remote-dark.png' });
  await page.getByRole('button', { name: '访问权限：帮我批准', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex-switch:dream-skin-status-changed', {
    detail: { installed: true, session: 'running', activeThemeId: 'fixture', activeThemeAppearance: 'light',
      activeThemeOverlayOpacity: 0.85 },
  })));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 240;
    const drawing = canvas.getContext('2d')!; drawing.fillStyle = '#35ada7'; drawing.fillRect(0, 0, 600, 240);
    const data = canvas.toDataURL('image/png').split(',')[1];
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([Uint8Array.from(atob(data), byte => byte.charCodeAt(0))],
      'screenshot.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  const preview = page.getByRole('img', { name: '待发送图片 1', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  expect(await preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: '../../.codex-tmp/gui-remote-paste-theme.png' });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => office.evaluate(() => window.chatTest.demoState().operations
    .filter(operation => operation.operation === 'send').map(operation => operation.images))).toEqual([
    [expect.stringMatching(/^data:image\/jpeg;base64,/)]]);
  await expect(preview).toHaveCount(0);
  expect(await page.evaluate(() => window.remoteGuiFixture.commands
    .filter(command => /codex_gui_(connect|disconnect|request|respond)$/.test(command)))).toEqual([]);
});

test('keeps input responsive during native image reads and discards reads from a previous computer', async ({ context, page }) => {
  for (const device of ['computer-one', 'computer-two']) {
    const host = await context.newPage();
    await host.goto(`/e2e/chat-harness.html?role=desktop&demo&device=${device}&socket=${encodeURIComponent(endpoint)}`);
    await expect(host.locator('#status')).toHaveText('registered');
  }
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  await chooseComputer(page, 'Office PC');
  await page.getByRole('button', { name: 'computer-one', exact: true }).click();
  await page.evaluate(() => { window.remoteGuiFixture.copyImage(); window.remoteGuiFixture.pauseClipboard(); });
  const beats = await page.evaluate(() => window.remoteGuiFixture.beats());
  const input = page.getByRole('textbox', { name: '聊天消息', exact: true });
  await input.dispatchEvent('keydown', { key: 'v', ctrlKey: true });
  await expect(page.getByText('正在添加附件…', { exact: true })).toBeVisible();
  await input.fill('draft while reading');
  await expect(input).toHaveValue('draft while reading');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.remoteGuiFixture.beats())).toBeGreaterThan(beats + 4);
  await chooseComputer(page, 'Home PC');
  await page.getByRole('button', { name: 'computer-two', exact: true }).click();
  await page.evaluate(() => window.remoteGuiFixture.releaseClipboard());
  await expect(page.getByRole('img', { name: '待发送图片 1', exact: true })).toHaveCount(0);
  await input.dispatchEvent('keydown', { key: 'v', ctrlKey: true });
  await expect(page.getByRole('img', { name: '待发送图片 1', exact: true })).toBeVisible();
  await chooseComputer(page, '本机');
  await expect(page.getByRole('textbox', { name: '本机草稿' })).toHaveValue('Local unsent draft');
});

test('keeps the account panel and device dropdown compact and responsive during slow discovery and a failed connection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/e2e/remote-gui-harness.html?socket=${encodeURIComponent(endpoint)}`);
  const before = await page.evaluate(() => window.remoteGuiFixture.beats());
  await page.getByRole('button', { name: /^切换 GUI 账户：/ }).click();
  await page.getByRole('button', { name: '切换设备', exact: true }).click();
  await expect(page.getByRole('button', { name: /Offline PC/ })).toBeDisabled();
  await page.evaluate(() => window.remoteGuiFixture.pauseDirectory());
  await page.getByRole('button', { name: '刷新设备列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新设备列表', exact: true })).toBeDisabled();
  await page.screenshot({ path: '../../.codex-tmp/gui-computer-menu-narrow.png' });
  await page.getByRole('button', { name: '切换设备', exact: true }).press('Escape');
  await expect(page.getByRole('region', { name: '设备列表' })).toBeHidden();
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
