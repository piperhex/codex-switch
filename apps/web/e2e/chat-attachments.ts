import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { connect, send, settled, screenshot, state } from './chat-helpers';

async function choosePhotos(page: Page, count: number) {
  await page.getByRole('button', { name: '添加内容', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '相册', exact: true }).click();
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(true);
  await picker.setFiles(Array.from({ length: count }, () => '../desktop/src-tauri/icons/128x128.png'));
  await expect(page.locator('.chat-attachment-preview')).toHaveCount(count);
}

export async function attachmentJourney({ page, request, info, relay }: {
  page: Page; request: APIRequestContext; info: TestInfo; relay: boolean;
}) {
  if (relay) await page.evaluate(() => {
    window.RTCPeerConnection = class {
      constructor() { throw new Error('Use relay for image regression'); }
    } as unknown as typeof RTCPeerConnection;
  });
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: relay ? '通过服务器连接' : '已直连' }))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '添加内容', exact: true }).click();
  await screenshot(page, info, 'photo-drawer');
  await page.keyboard.press('Escape');
  // Mobile sheets use an explicit close button.
  const close = page.getByRole('button', { name: '关闭', exact: true });
  if (await close.isVisible()) await close.click();
  await choosePhotos(page, 2);
  await page.getByRole('button', { name: '移除图片 1', exact: true }).click();
  await expect(page.locator('.chat-attachment-preview')).toHaveCount(1);
  await screenshot(page, info, 'photo-preview');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(async () => (await state(request)).operations.filter((item) => item.operation === 'send').length)
    .toBe(1);
  const sent = (await state(request)).operations.find((item) => item.operation === 'send')!;
  expect(sent.text).toBe('');
  expect(sent.images).toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/)]);

  await settled(page);
  await send(page, 'slow image conversation');
  await expect(page.getByRole('button', { name: '暂停生成' })).toBeVisible();
  await choosePhotos(page, 1);
  await page.getByRole('textbox', { name: '聊天消息' }).fill('补充这张图片');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const queue = page.getByRole('region', { name: '待发送消息', exact: true });
  await expect(queue).toContainText('补充这张图片');
  await expect(queue).toContainText('1 张图片');
  await queue.getByRole('button', { name: '立即发送', exact: true }).click();
  await expect.poll(async () => (await state(request)).operations.filter((item) => item.operation === 'steer').length)
    .toBe(1);
  const steered = (await state(request)).operations.find((item) => item.operation === 'steer')!;
  expect(steered.text).toBe('补充这张图片');
  expect(steered.images).toEqual(sent.images);
  await expect(page.locator('.chat-attachment-preview')).toHaveCount(0);
  await page.getByRole('button', { name: '暂停生成' }).click();
  await settled(page);
  if (relay) expect((await state(request)).relayFrames).toBeGreaterThan(0);
}
