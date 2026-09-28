import { expect, test } from '@playwright/test';
import { connect, fixtureUrl, login, operationCount, state } from './chat-helpers';

test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await request.post(`${fixtureUrl}/test/skills`, { data: { extra: 30 } });
  await login(page);
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 16_000 });
  await page.getByRole('textbox', { name: '聊天消息' }).fill('/');
  await expect(page.getByRole('menuitem', { name: '使用技能 skill-29', exact: true })).toBeAttached();
});

test('navigates enabled options with arrows, wraps and keeps the active option visible', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const active = page.locator('.chat-menu-options [aria-current="true"]');
  const popover = page.locator('.chat-composer-popover');
  await expect(page.getByRole('menuitem', { name: '压缩上下文' })).toBeDisabled();
  await expect(active).toHaveAccessibleName('目标模式');
  await input.press('ArrowDown');
  await expect(active).toHaveAccessibleName('使用技能 skill-0');
  await input.press('ArrowUp');
  await expect(active).toHaveAccessibleName('目标模式');
  await input.press('ArrowUp');
  await expect(active).toHaveAccessibleName('使用技能 代码检查');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-activedescendant', (await active.getAttribute('id'))!);
  await expect.poll(() => popover.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const item = (await active.boundingBox())!;
  const popup = (await popover.boundingBox())!;
  const header = (await popover.locator('header').boundingBox())!;
  expect(item.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(item.y + item.height).toBeLessThanOrEqual(popup.y + popup.height + 1);
  await input.press('ArrowDown');
  await expect(active).toHaveAccessibleName('目标模式');
  await expect(active).toBeInViewport({ ratio: 1 });
  expect((await active.boundingBox())!.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
});

test('resets selection when filtering and confirms a skill without sending', async ({ page, request }) => {
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const active = page.locator('.chat-menu-options [aria-current="true"]');
  await input.press('ArrowUp');
  await input.fill('/skill-2');
  await expect(active).toHaveAccessibleName('使用技能 skill-2');
  await input.press('ArrowDown');
  await expect(active).toHaveAccessibleName('使用技能 skill-20');
  await input.press('Enter');
  await expect(input).toHaveValue('$skill-20 ');
  await expect(input).toBeFocused();
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await expect(page.locator('.chat-composer-popover')).toHaveCount(0);
  expect(await operationCount(request, 'send')).toBe(0);
  await input.fill('$review');
  await expect(active).toHaveAccessibleName('使用技能 代码检查');
  await input.press('Enter');
  await expect(input).toHaveValue('$review ');
});

test('handles disabled and empty results and dismisses with Escape', async ({ page, request }) => {
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const popover = page.locator('.chat-composer-popover');
  for (const query of ['/disabled', '/no-such-skill']) {
    await input.fill(query);
    await expect(popover).toBeVisible();
    await expect(page.locator('.chat-menu-options [aria-current="true"]')).toHaveCount(0);
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    await input.press('Enter');
    await expect(input).toHaveValue(query);
    await input.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(input).toBeFocused();
  }
  expect(await operationCount(request, 'send')).toBe(0);
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('/no-such-skill\n');
});

test('leaves composition keys and modified arrows to the input', async ({ page, request }) => {
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const active = page.locator('.chat-menu-options [aria-current="true"]');
  await input.fill('/review');
  await expect(active).toHaveAccessibleName('使用技能 代码检查');
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    await input.dispatchEvent('keydown', { key, code: key, isComposing: true });
    await input.dispatchEvent('keydown', { key, code: key, keyCode: 229 });
    await expect(active).toHaveAccessibleName('使用技能 代码检查');
    await expect(input).toHaveValue('/review');
  }
  await input.fill('/');
  await input.press('Shift+ArrowDown');
  await expect(active).toHaveAccessibleName('目标模式');
  await input.press('ArrowDown');
  await expect(active).toHaveAccessibleName('使用技能 skill-0');
  expect(await operationCount(request, 'send')).toBe(0);
});

test('uses the keyboard for plugin suggestions after loading', async ({ page, request }) => {
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const active = page.locator('.chat-menu-options [aria-current="true"]');
  await input.fill('');
  await page.getByRole('button', { name: '添加内容', exact: true }).click();
  await page.getByRole('menuitem', { name: '插件', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '使用插件 GitHub' })).toBeAttached();
  await expect(active).toHaveAccessibleName('使用插件 GitHub');
  await input.press('ArrowDown');
  await expect(active).not.toHaveAccessibleName('使用插件 GitHub');
  await input.press('ArrowUp');
  await expect(active).toHaveAccessibleName('使用插件 GitHub');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '移除GitHub', exact: true })).toBeVisible();
  await expect(page.locator('.chat-composer-popover')).toHaveCount(0);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  expect(await operationCount(request, 'send')).toBe(0);
});

test('references a remote conversation with @ and sends it without losing the message', async ({ page, request }) => {
  const input = page.getByRole('textbox', { name: '聊天消息' });
  await input.fill('@移动端');
  const menu = page.getByRole('menu', { name: '对话', exact: true });
  await expect(menu.getByRole('menuitem')).toHaveCount(1);
  await expect(menu).toContainText('移动端聊天体验');
  await page.screenshot({ path: `../../.codex-tmp/web-conversation-${page.viewportSize()!.width}.png` });
  expect((await page.locator('.chat-composer-popover').boundingBox())!.width).toBeLessThanOrEqual(400);
  await expect(page.getByLabel('插件列表')).toHaveCount(0);
  await input.press('Tab');
  await expect(page.getByText('@移动端聊天体验', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  expect(await operationCount(request, 'send')).toBe(0);
  await input.fill('参考这个对话继续');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(async () => (await state(request)).operations.find(entry => entry.operation === 'send'))
    .toMatchObject({ text: '参考这个对话继续', attachments: [
      { kind: 'conversation', name: '移动端聊天体验', path: 'codex-thread://demo-chat' },
    ] });
  await expect(page.getByText('@移动端聊天体验', { exact: true })).toHaveCount(0);
});

for (const target of ['.chat-menu-options', '.chat-command-menu header']) {
  test(`scrolls skills both ways with the wheel over ${target} and chooses a later skill`, async ({ page }) => {
    const popover = page.locator('.chat-composer-popover');
    const position = () => popover.evaluate(node => node.scrollTop);
    const input = page.getByRole('textbox', { name: '聊天消息' });
    await page.locator(target).hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(position).toBeGreaterThan(0);
    await expect(input).toHaveValue('/');
    await page.mouse.wheel(0, -10000);
    await expect.poll(position).toBe(0);
    await page.mouse.wheel(0, 10000);
    await expect(page.getByRole('button', { name: '关闭命令和技能' })).toBeInViewport();
    const last = page.getByRole('menuitem', { name: '使用技能 skill-9', exact: true });
    await expect(last).toBeInViewport();
    await last.click();
    await expect(input).toHaveValue('$skill-9 ');
    await expect(popover).toHaveCount(0);
    await expect(input).toBeFocused();
  });
}

test('keeps touch scrolling and skill selection working in a phone browser', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch gestures are covered by the mobile project.');
  const popover = page.locator('.chat-composer-popover');
  const box = (await popover.boundingBox())!;
  const x = box.x + box.width / 2;
  const start = box.y + box.height - 24;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
    for (let step = 1; step <= 8; step++) {
      const y = start - (box.height - 80) * step / 8;
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
  await expect.poll(() => popover.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const input = page.getByRole('textbox', { name: '聊天消息' });
  await expect(input).toHaveValue('/');
  await page.getByRole('menuitem', { name: '使用技能 skill-9', exact: true }).tap();
  await expect(input).toHaveValue('$skill-9 ');
  await expect(popover).toHaveCount(0);
});
