import { expect, type Page } from '@playwright/test';
import { connect } from './chat-helpers';

export async function composerLayout(page: Page) {
  await connect(page);
  const input = page.getByRole('textbox', { name: '聊天消息' });
  const send = page.getByRole('button', { name: '发送消息' });
  const add = page.getByRole('button', { name: '添加内容' });
  await expect(page.locator('.chat-composer-settings')).toHaveCount(0);
  await expect(send).toHaveText('');
  await expect(send).toHaveCSS('border-radius', '50%');
  for (const text of ['一行消息', '第一行\n第二行\n第三行', '多行消息\n'.repeat(20)]) {
    await input.fill(text);
    const field = (await page.locator('.chat-composer-field').boundingBox())!;
    const content = (await input.boundingBox())!;
    const left = (await add.boundingBox())!;
    const right = (await send.boundingBox())!;
    expect(left.y).toBeGreaterThanOrEqual(content.y + content.height);
    expect(right.y).toBe(left.y);
    expect(left.x).toBeGreaterThan(field.x);
    expect(left.x - field.x).toBeLessThan(12);
    expect(field.x + field.width - right.x - right.width).toBeLessThan(12);
    expect(right.y + right.height).toBeLessThan(field.y + field.height);
    expect(right.width).toBe(right.height);
  }
  await input.fill('');
  await expect(send).toBeDisabled();
  await page.evaluate(() => {
    // Headless mobile emulation does not open an OS keyboard; exercise its viewport resize events.
    if (!window.visualViewport) throw new Error('Visual viewport is required');
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => innerHeight - 300 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.chat-composer-settings')).toBeVisible();
  await page.getByRole('button', { name: /聊天设置|正在同步模型|测试模型/ }).click();
  await expect(page.getByRole('button', { name: '设置推理强度' })).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await input.focus();
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, 'height');
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    await expect(page.locator('.chat-composer-settings')).toHaveCount(0);
  }
  await input.blur();
  await expect(page.locator('.chat-composer-settings')).toHaveCount(0);
}
