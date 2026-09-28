import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';
import { readFile } from 'node:fs/promises';

declare global { interface Window {
  desktopTest: typeof desktopTest;
  browserClipboard: { text: string; image?: string; denied: boolean };
} }

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'Physical mouse and keyboard coverage uses the PC browser.');
  await page.addInitScript(() => {
    // Keep browser clipboard verification inside this test context, without changing the user's OS clipboard.
    window.browserClipboard = { text: '', denied: false };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      read: async () => [new ClipboardItem({ 'text/plain': new Blob([window.browserClipboard.text]) })],
      readText: async () => window.browserClipboard.text,
      writeText: async (text: string) => {
        if (window.browserClipboard.denied) throw new DOMException('Denied', 'NotAllowedError');
        window.browserClipboard.text = text;
      },
      write: async (items: ClipboardItem[]) => {
        if (window.browserClipboard.denied) throw new DOMException('Denied', 'NotAllowedError');
        const blob = await items[0].getType('image/png');
        window.browserClipboard.image = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
      },
    } });
  });
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
});

async function focusDesktop(page: Page) {
  await page.locator('.rd-touch').click();
  await expect(page.locator('.rd-key-capture')).toBeFocused();
  await page.evaluate(() => { window.desktopTest.inputs.length = 0; });
}

test('maps hover, left/right/middle clicks, dragging and wheel to the actual video', async ({ page }) => {
  await expect(page.locator('.rd-mouse-layer')).toHaveCount(0);
  const video = (await page.locator('video').boundingBox())!;
  const point = { x: video.x + (video.width - 1) * 0.7, y: video.y + (video.height - 1) * 0.6 };
  await page.mouse.move(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toMatchObject({ kind: 'move', x: expect.closeTo(0.7, 2), y: expect.closeTo(0.6, 2) });
  for (const button of ['left', 'right', 'middle'] as const) {
    await page.mouse.click(point.x, point.y, { button });
    await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
      .toEqual({ kind: 'button', button, down: false });
  }
  await page.mouse.down(); await page.mouse.move(point.x + 40, point.y + 25); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'wheel', delta: -120 });
  const count = await page.evaluate(() => window.desktopTest.inputs.length);
  await page.mouse.click(video.x + video.width / 2, 2);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.desktopTest.inputs.length)).toBe(count);
});

test('forwards physical keys, editing shortcuts and IME text, releasing modifiers on blur', async ({ page }) => {
  await focusDesktop(page);
  await page.keyboard.press('Control+a'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('F2');
  await page.keyboard.insertText('中文输入');
  await page.keyboard.down('Shift');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'keyboard', code: 'ShiftLeft', down: false });
  const inputs = await page.evaluate(() => window.desktopTest.inputs);
  expect(inputs).toContainEqual({ kind: 'keyboard', code: 'ControlLeft', down: true });
  expect(inputs).toContainEqual({ kind: 'keyboard', code: 'KeyA', down: true });
  expect(inputs).toContainEqual({ kind: 'keyboard', code: 'ControlLeft', down: false });
  expect(inputs).toContainEqual({ kind: 'keyboard', code: 'ArrowLeft', down: true });
  expect(inputs).toContainEqual({ kind: 'keyboard', code: 'F2', down: true });
  expect(inputs).toContainEqual({ kind: 'text', text: '中文输入' });
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: '键盘', exact: true }).click();
  const count = inputs.length;
  await page.getByRole('textbox', { name: '发送到电脑的文字' }).fill('local form');
  expect(await page.evaluate(() => window.desktopTest.inputs.length)).toBe(count);
});

test('copies remote text with Ctrl+C and Ctrl+X, and pastes local text through the clipboard', async ({ page }) => {
  await focusDesktop(page);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => window.browserClipboard.text)).toBe('Remote clipboard 测试');
  await page.keyboard.press('Control+x');
  await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.requests
    .filter(message => message.request.action === 'read').map(message => message.request)))
    .toEqual([{ action: 'read', shortcut: 'copy' }, { action: 'read', shortcut: 'cut' }]);
  await expect(page.getByText('已复制到本机。')).toBeVisible();
  await page.locator('.rd-key-capture').evaluate(element => {
    const data = new DataTransfer(); data.setData('text/plain', '本机 → 远程\nclipboard');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.content))
    .toEqual({ format: 'text', text: '本机 → 远程\nclipboard' });
  expect(await page.evaluate(() => window.desktopTest.inputs.some(input => input.kind === 'keyboard'
    && ['KeyC', 'KeyX', 'KeyV'].includes(input.code)))).toBe(false);
});

test('transfers clipboard PNG images in both directions', async ({ page }) => {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await focusDesktop(page);
  await page.evaluate(data => { window.desktopTest.clipboard.content = { format: 'image', data }; }, png);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => window.browserClipboard.image)).toBe(png);
  await page.locator('.rd-key-capture').evaluate((element, png) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(png), character => character.charCodeAt(0))],
      'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
  await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.pastes)).toBe(1);
  expect(await page.evaluate(() => window.desktopTest.clipboard.content.format)).toBe('image');
});

test('uploads files in bounded chunks while keeping the desktop responsive and downloads remote files',
  async ({ page }) => {
    const bytes = Buffer.alloc(512 * 1024, 65);
    await page.getByRole('button', { name: '剪贴板', exact: true }).click();
    await page.getByLabel('选择发送的文件').setInputFiles({ name: 'example.bin', mimeType: 'application/octet-stream',
      buffer: bytes });
    await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.pastes)).toBe(1);
    const clipboard = await page.evaluate(() => window.desktopTest.clipboard);
    expect(clipboard.content).toEqual({ format: 'files', files: [{ name: 'example.bin', data: bytes.toString('base64') }] });
    expect(clipboard.requests.filter(message => message.request.action === 'append').length).toBeGreaterThan(1);
    expect(Math.max(...clipboard.requests.map(message => JSON.stringify(message).length))).toBeLessThan(64 * 1024);
    const frames = await page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '获取远程剪贴板' }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe('example.bin');
    expect(await readFile((await saved.path())!)).toEqual(bytes);
    await expect.poll(() => page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames))
      .toBeGreaterThan(frames);
    await expect(page.getByRole('button', { name: '下载 example.bin' })).toBeVisible();
  });

test('retains received content when clipboard permission is denied and permits an explicit retry', async ({ page }) => {
  await focusDesktop(page);
  await page.evaluate(() => { window.browserClipboard.denied = true; });
  await page.keyboard.press('Control+c');
  await expect(page.getByRole('textbox', { name: '远程剪贴板文本' })).toHaveValue('Remote clipboard 测试');
  await expect(page.getByText('内容已收到，请点击“复制到本机”。')).toBeVisible();
  await page.evaluate(() => { window.browserClipboard.denied = false; });
  await page.getByRole('button', { name: '复制到本机' }).click();
  await expect.poll(() => page.evaluate(() => window.browserClipboard.text)).toBe('Remote clipboard 测试');
  const bounds = (await page.getByRole('complementary', { name: '剪贴板' }).boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(400);
});

test('keeps an older host connected and explains the required update before using new controls', async ({ page }) => {
  await page.goto('e2e/remote-desktop-harness.html?legacy');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await focusDesktop(page); await page.keyboard.press('a'); await page.keyboard.press('Control+c');
  await expect(page.getByRole('complementary', { name: '剪贴板' }))
    .toContainText('请更新远程电脑上的应用，启用实体键盘和剪贴板。');
  expect(await page.evaluate(() => window.desktopTest.inputs.some(input => input.kind === 'keyboard'))).toBe(false);
  expect(await page.evaluate(() => window.desktopTest.clipboard.requests)).toEqual([]);
  await expect(page.getByText('桌面连接已断开，请重新连接。')).not.toBeVisible();
});
