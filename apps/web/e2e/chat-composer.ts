import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { connect, operationCount, screenshot, state, fixtureUrl } from './chat-helpers';

export async function composerLayout(page: Page) {
  await connect(page);
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const send = page.getByRole('button', { name: '发送消息' });
  const add = page.getByRole('button', { name: '添加内容', exact: true });
  const settings = page.locator('.chat-model');
  const desktop = page.viewportSize()!.width > 860;
  await expect(settings).toBeVisible();
  if (desktop) {
    await expect(page.locator('.chat-composer')).not.toHaveClass(/is-compact/);
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(83);
    await expect(page.getByText('Enter 发送 · Shift + Enter 换行')).toBeVisible();
  } else await expect(page.locator('.chat-composer')).toHaveClass(/is-compact/);
  await expect(send).toHaveCSS('border-radius', '50%');
  for (const text of ['一行消息', '第一行\n第二行\n第三行', '多行消息\n'.repeat(60)]) {
    await input.fill(text);
    const content = (await page.locator('.chat-composer-content').boundingBox())!;
    const left = (await add.boundingBox())!;
    const right = (await send.boundingBox())!;
    expect(left.y).toBeGreaterThanOrEqual(content.y + content.height - 1);
    if (desktop) expect(right.y).toBeGreaterThanOrEqual(left.y);
    else expect(right.y).toBe(left.y);
    expect(right.y + right.height).toBeLessThan(page.viewportSize()!.height);
    expect(right.width).toBe(right.height);
    await expect(settings).toBeVisible();
  }
  await input.fill('');
  await expect(send).toBeDisabled();
  if (!desktop) await expect(page.locator('.chat-composer')).toHaveClass(/is-compact/);
  await page.evaluate(() => {
    if (!window.visualViewport) throw new Error('Visual viewport is required');
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => innerHeight - 300 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(settings).toBeVisible();
  await settings.click();
  if (desktop) {
    await expect(page.getByRole('slider', { name: '推理强度' })).toBeVisible();
    await page.keyboard.press('Escape');
  } else {
    await expect(page.getByRole('button', { name: '设置推理强度' })).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  }
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, 'height');
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await input.blur();
  await expect(settings).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await input.fill('窄屏长消息\n'.repeat(40));
  await expect(send).toBeInViewport();
  await expect(settings).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await input.fill('');
  await expect(page.locator('.chat-composer')).toHaveClass(/is-compact/);
}

export async function desktopComposer(page: Page, request: APIRequestContext, info: TestInfo) {
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ })).toBeVisible();
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const access = page.getByRole('button', { name: /^访问权限：/ });
  await access.click();
  expect((await page.locator('.chat-composer-access-menu').boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.getByRole('menuitemradio', { name: /请求批准/ }).click();
  await expect.poll(async () => (await state(request)).composer.settings.access).toBe('read-only');
  await expect(access).toHaveAccessibleName('访问权限：请求批准');
  await page.getByRole('button', { name: /^模型与推理强度：/ }).click();
  const speed = page.locator('.request-speed-button');
  await speed.click();
  await expect.poll(async () => (await state(request)).composer.settings.speed).toBe('fast');
  await request.post(`${fixtureUrl}/test/composer`, { data: { speed: 'normal' } });
  await expect(speed).toHaveAttribute('data-speed', 'normal');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: '今日用量' })).toContainText('USD');
  await input.fill('电脑输入第一行');
  await input.press('Shift+Enter');
  await input.pressSequentially('second line slow');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  expect(await operationCount(request, 'send')).toBe(0);
  await expect(input).toHaveValue('电脑输入第一行\nsecond line slow');
  await screenshot(page, info, 'desktop-composer');
  await input.press('Enter');
  await expect.poll(() => operationCount(request, 'send')).toBe(1);
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: '暂停生成' })).toBeVisible();
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '暂停生成' })).toBeVisible();
  await input.fill('生成时仍可输入');
  const usageReads = await operationCount(request, 'usageSummary');
  await expect.poll(() => operationCount(request, 'usageSummary'), { timeout: 8_000 }).toBeGreaterThan(usageReads);
  await expect(input).toHaveValue('生成时仍可输入');
}
