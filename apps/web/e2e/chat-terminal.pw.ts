import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { connect, fixtureUrl, login, openChatList, operationCount, screenshot, state } from './chat-helpers';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'mobile' && !info.title.startsWith('desktop'),
  'Phone terminal drawer'));

test('opens a 90 percent terminal drawer, preserves its shell and draft, and sends input over P2P and Relay',
  async ({ page, request }, info) => {
    await request.post(`${fixtureUrl}/test/reset`);
    await login(page); await connect(page);
    await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 20_000 });
    await openChatList(page);
    await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
    const draft = page.getByRole('textbox', { name: '聊天消息' });
    await draft.fill('保留聊天草稿');
    const toggle = page.locator('.chat-header').getByRole('button', { name: '打开工具' });
    await toggle.click();
    await page.getByRole('button', { name: '终端', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '远程终端', exact: true });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '正在打开终端' })).toHaveCount(0);
    const bounds = (await drawer.boundingBox())!;
    expect(Math.abs(bounds.height - 844 * .9)).toBeLessThan(2);
    expect(bounds.width).toBe(390);
    await expect.poll(async () => (await state(request)).operations.find(op => op.operation === 'guiTerminalOpen')?.cwd)
      .toBe('F:/projects/demo');
    const terminal = page.locator('.xterm-helper-textarea');
    await terminal.fill('echo phone'); await terminal.press('Enter');
    const input = async () => (await state(request)).operations.filter(op => op.operation === 'guiTerminalWrite')
      .map(op => op.data).join('');
    await expect.poll(input).toContain('echo phone\r');
    await drawer.getByRole('button', { name: 'Ctrl+C', exact: true }).tap();
    await expect.poll(input).toContain('\x03');
    await screenshot(page, info, 'phone-terminal-p2p');
    // StrictMode probes mount cleanup in development; compare the settled session before and after hiding.
    const opened = await operationCount(request, 'guiTerminalOpen');
    const closed = await operationCount(request, 'guiTerminalClose');
    await drawer.getByRole('button', { name: '收起终端', exact: true }).click();
    await expect(drawer).toBeHidden(); await expect(draft).toHaveValue('保留聊天草稿');
    expect(await operationCount(request, 'guiTerminalClose')).toBe(closed);
    await request.post(`${fixtureUrl}/test/fallback`);
    await expect(page.getByRole('status').filter({ hasText: 'Relay' })).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    await page.getByRole('button', { name: '终端', exact: true }).click();
    await expect(drawer).toBeVisible();
    expect(await operationCount(request, 'guiTerminalOpen')).toBe(opened);
    await terminal.fill('echo relay'); await terminal.press('Enter');
    await expect.poll(input).toContain('echo relay\r');
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 500 });
      window.visualViewport?.dispatchEvent(new Event('resize'));
    });
    await expect.poll(async () => Math.round((await drawer.boundingBox())!.height)).toBe(450);
    await screenshot(page, info, 'phone-terminal-keyboard');
    await drawer.getByRole('button', { name: '关闭终端 1', exact: true }).click();
    await expect.poll(() => operationCount(request, 'guiTerminalClose')).toBe(closed + 1);
    await expect(drawer).toHaveCount(0);
  });

test('switching computers detaches the hidden terminal without closing the PC shell', async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
  const devices = ['工作电脑', '家中电脑'].map((name, index) => ({ name, deviceId: `terminal-computer-${index}`,
    platform: 'Windows', online: true, capabilities: [], localProxyRunning: false,
    lastSeenAt: new Date().toISOString() }));
  await page.route('**/devices', route => route.fulfill({ json: { devices } }));
  await page.routeWebSocket('**/device-switch', socket => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'devices-snapshot', devices })));
  });
  await login(page); await connect(page);
  const toggle = page.locator('.chat-header').getByRole('button', { name: '打开工具' });
  await expect(toggle).toBeEnabled(); await toggle.tap();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '远程终端', exact: true });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '正在打开终端' })).toHaveCount(0);
  const opened = await operationCount(request, 'guiTerminalOpen');
  const closed = await operationCount(request, 'guiTerminalClose');
  await drawer.getByRole('button', { name: '收起终端', exact: true }).tap();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: '选择电脑', exact: true }).tap();
  await page.getByRole('button', { name: '家中电脑 在线', exact: true }).tap();
  await expect(page.getByRole('button', { name: '选择电脑', exact: true })).toContainText('家中电脑');
  await expect(drawer).toBeHidden();
  expect(await operationCount(request, 'guiTerminalClose')).toBe(closed);
  await expect(toggle).toBeEnabled(); await toggle.tap();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('家中电脑');
  // Both device aliases in this fixture route to the same PC, so its retained shell is discovered again.
  expect(await operationCount(request, 'guiTerminalOpen')).toBe(opened);
});

test('restores the same shell and output after disconnecting and reloading the phone page', async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await login(page); await connect(page);
  const toggle = () => page.locator('.chat-header').getByRole('button', { name: '打开工具' });
  await expect(toggle()).toBeEnabled(); await toggle().click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '远程终端', exact: true });
  await expect(drawer).toBeVisible();
  await expect(page.locator('.xterm-rows')).toContainText('Remote shell ready');
  const input = page.locator('.xterm-helper-textarea');
  await input.fill('retained-marker'); await input.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('retained-marker');
  const opened = await operationCount(request, 'guiTerminalOpen');
  const id = (await state(request)).operations.find(operation => operation.operation === 'guiTerminalWrite')!.id;
  await request.post(`${fixtureUrl}/test/disconnect`);
  await expect.poll(async () => (await state(request)).mobileConnections).toBeGreaterThan(1);
  await expect(page.locator('.xterm-rows')).toContainText('retained-marker');
  await page.reload(); await connect(page);
  await expect(toggle()).toBeEnabled(); await toggle().click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(page.locator('.xterm-rows')).toContainText('retained-marker');
  expect(await operationCount(request, 'guiTerminalOpen')).toBe(opened);
  expect(await operationCount(request, 'guiTerminalClose')).toBe(0);
  await input.fill('continued-marker'); await input.press('Enter');
  await expect.poll(async () => (await state(request)).operations.filter(operation =>
    operation.operation === 'guiTerminalWrite').at(-1)?.id).toBe(id);
  await expect(page.locator('.xterm-rows')).toContainText('continued-marker');
  await drawer.getByRole('button', { name: '关闭终端 1', exact: true }).click();
  await expect.poll(() => operationCount(request, 'guiTerminalClose')).toBe(1);
  await page.reload(); await connect(page);
  await expect(toggle()).toBeEnabled(); await toggle().click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect.poll(() => operationCount(request, 'guiTerminalOpen')).toBe(opened + 1);
  await expect(page.locator('.xterm-rows')).not.toContainText('retained-marker');
});

test('bundled Android terminal renders output as text and forwards typing, shortcuts and resizing', async ({ page }) => {
  const html = readFileSync(new URL('../../native/assets/terminal.html', import.meta.url), 'utf8');
  await page.addInitScript(() => {
    const host = window as unknown as { messages: string[]; ReactNativeWebView: { postMessage: (data: string) => void } };
    host.messages = []; host.ReactNativeWebView = { postMessage: data => host.messages.push(data) };
  });
  await page.route('**/native-terminal.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('native-terminal.html');
  const messages = () => page.evaluate(() => (window as unknown as { messages: string[] }).messages.map(raw =>
    JSON.parse(raw) as { type: string; data?: string }));
  await expect.poll(async () => (await messages()).some(value => value.type === 'ready')).toBe(true);
  await page.evaluate(() => {
    const host = window as unknown as { remoteTerminal: (event: object) => void };
    host.remoteTerminal({ type: 'output', data: [...new TextEncoder().encode('Android shell ready\r\n<script>bad</script>')] });
  });
  await expect(page.locator('.xterm-rows')).toContainText('<script>bad</script>');
  const input = page.locator('.xterm-helper-textarea');
  await input.fill('echo android'); await input.press('Enter');
  await page.getByRole('button', { name: 'Ctrl+C', exact: true }).tap();
  await expect.poll(async () => (await messages()).filter(value => value.type === 'input')
    .map(value => value.data).join('')).toContain('echo android\r\x03');
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => (await messages()).filter(value => value.type === 'resize').length).toBeGreaterThan(0);
});

test('desktop browser restores retained terminals in a wide drawer', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'Wide terminal drawer');
  await request.post(`${fixtureUrl}/test/reset`);
  await login(page); await connect(page);
  const toggle = page.locator('.chat-header').getByRole('button', { name: '打开工具' });
  await expect(toggle).toBeEnabled(); await toggle.click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '远程终端', exact: true });
  await expect(drawer).toBeVisible();
  await expect(page.locator('.xterm-rows')).toContainText('Remote shell ready');
  const bounds = (await drawer.boundingBox())!;
  expect(Math.round(bounds.width)).toBe(896);
  const opened = await operationCount(request, 'guiTerminalOpen');
  await drawer.getByRole('button', { name: '收起终端', exact: true }).click();
  await page.reload(); await connect(page);
  await expect(toggle).toBeEnabled(); await toggle.click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(page.locator('.xterm-rows')).toContainText('Remote shell ready');
  expect(await operationCount(request, 'guiTerminalOpen')).toBe(opened);
  expect(await operationCount(request, 'guiTerminalClose')).toBe(0);
  await screenshot(page, info, 'wide-retained-terminal');
});

test('desktop and mobile terminals are isolated by project and restored after reload', async ({ page, request }, info) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await login(page); await connect(page);
  const chooseRootProject = async () => {
    await page.getByRole('button', { name: '选择项目', exact: true }).click();
    await page.getByRole('button', { name: '此电脑', exact: true }).click();
    await page.getByRole('button', { name: 'F:', exact: true }).click();
    await page.getByRole('button', { name: 'projects', exact: true }).click();
    await page.getByRole('button', { name: '选择此文件夹', exact: true }).click();
  };
  const toggle = page.locator('.chat-header').getByRole('button', { name: '打开工具' });
  const drawer = page.getByRole('dialog', { name: '远程终端', exact: true });
  const rows = page.locator('.xterm-rows');
  const hide = () => drawer.getByRole('button', { name: '收起终端', exact: true }).click();
  const type = async (text: string) => {
    const input = page.locator('.xterm-helper-textarea');
    await input.fill(text); await input.press('Enter');
    await expect(rows).toContainText(text);
  };
  await chooseRootProject();
  await toggle.click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await type('parent-project-marker');
  await hide();
  await openChatList(page);
  await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
  await toggle.click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(rows).toContainText('Remote shell ready');
  await expect(rows).not.toContainText('parent-project-marker');
  await type('demo-project-marker');
  await hide();
  await openChatList(page);
  await page.getByRole('button', { name: /在 .* 中新建对话/ }).click();
  await toggle.click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(rows).toContainText('demo-project-marker');
  expect(await operationCount(request, 'guiTerminalOpen')).toBe(2);
  await hide();
  await chooseRootProject();
  await toggle.click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(rows).toContainText('parent-project-marker');
  await expect(rows).not.toContainText('demo-project-marker');
  expect(await operationCount(request, 'guiTerminalClose')).toBe(0);
  await drawer.getByRole('button', { name: '关闭终端 1', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await page.reload(); await connect(page);
  await openChatList(page);
  await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
  await toggle.click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(rows).toContainText('demo-project-marker');
  await expect(rows).not.toContainText('parent-project-marker');
  expect(await operationCount(request, 'guiTerminalOpen')).toBe(2);
  expect(await operationCount(request, 'guiTerminalClose')).toBe(1);
  await screenshot(page, info, 'project-terminal-restored');
});
