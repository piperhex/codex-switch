import { readFile } from 'node:fs/promises';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { connect, settled, state } from './chat-helpers';

export async function clipboardJourney(page: Page, request: APIRequestContext) {
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 16_000 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const input = page.getByRole('textbox', { name: '聊天消息' });
  await input.fill('保留草稿');
  await input.press('End');
  await page.evaluate(() => navigator.clipboard.writeText('和粘贴的文字'));
  await input.press('Control+V');
  await expect(input).toHaveValue('保留草稿和粘贴的文字');
  const image = await readFile('../desktop/src-tauri/icons/32x32.png');
  await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  }, image.toString('base64'));
  await input.press('Control+V');
  await expect(page.getByRole('img', { name: '待发送图片 1' })).toBeVisible();
  // QQ supplies text/html plus text/plain. Embedded image bytes work without filesystem access.
  await input.fill('前文待替换后文');
  await input.evaluate(node => node.setSelectionRange(2, 5));
  await page.evaluate(async base64 => {
    const html = `图片说明<br><img src="data:image/png;base64,${base64}">`;
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob(['图片说明\n'], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })]);
  }, image.toString('base64'));
  await input.press('Control+V');
  await expect(input).toHaveValue('前文图片说明\n后文');
  await expect(page.getByRole('img', { name: '待发送图片 2' })).toBeVisible();
  await expect.poll(() => input.evaluate(node => node.selectionStart)).toBe(7);
  // A browser may only expose QQ's local image URL. Keep its text and report the missing image.
  await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({
    'text/plain': new Blob(['保留说明'], { type: 'text/plain' }),
    'text/html': new Blob(['保留说明<img src="file:///C:/QQ/unavailable.png">'], { type: 'text/html' }),
  })]));
  await input.press('Control+V');
  await expect(input).toHaveValue('前文图片说明\n保留说明后文');
  await expect(page.getByRole('alert').filter({ hasText: '部分图片未能粘贴' })).toBeVisible();
  await input.fill('保留草稿和粘贴的文字');
  // Browser clipboard writers do not support arbitrary OS files; exercise the native paste-event payload.
  await input.evaluate((node, base64) => {
    const clipboardData = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    clipboardData.items.add(new File([bytes], 'second.png', { type: 'image/png' }));
    clipboardData.items.add(new File(['pasted document'], 'notes.txt', { type: 'text/plain' }));
    clipboardData.items.add(new File(['unknown file type'], 'sample.dat'));
    clipboardData.setData('text/plain', 'Do not insert file names into the draft');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, image.toString('base64'));
  await expect(page.getByRole('img', { name: '待发送图片 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除notes.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除sample.dat' })).toBeVisible();
  await expect(input).toHaveValue('保留草稿和粘贴的文字');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await settled(page);
  const sent = (await state(request)).operations.findLast(entry => entry.operation === 'send');
  expect(sent?.text).toBe('保留草稿和粘贴的文字');
  expect(sent?.images).toHaveLength(3);
  expect(sent?.attachments).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'notes.txt', data: Buffer.from('pasted document').toString('base64') }),
    expect.objectContaining({ name: 'sample.dat', data: Buffer.from('unknown file type').toString('base64') }),
  ]));
}
