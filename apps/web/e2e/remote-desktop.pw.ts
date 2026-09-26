import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test('streams video, controls mouse and keyboard, applies display settings and closes capture', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '远程桌面' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(5);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
  await page.getByRole('button', { name: '鼠标左键', exact: true }).click();
  await page.getByRole('button', { name: '鼠标右键', exact: true }).click();
  await page.getByRole('button', { name: '向下滚动' }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.length)).toBe(5);
  expect(await page.evaluate(() => window.desktopTest.inputs)).toEqual([
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
    { kind: 'button', button: 'right', down: true }, { kind: 'button', button: 'right', down: false },
    { kind: 'wheel', delta: -120 },
  ]);
  await page.screenshot({ path: info.outputPath('remote-desktop-mouse.png') });
  const left = await page.getByRole('button', { name: '鼠标左键', exact: true }).boundingBox();
  await page.mouse.move(left!.x + left!.width / 2, left!.y + left!.height / 2);
  await page.mouse.down();
  await expect(page.getByText('拖拽中', { exact: true })).toBeVisible();
  await page.mouse.up();
  const pad = await page.locator('.rd-pad').boundingBox();
  await page.mouse.move(pad!.x + 20, pad!.y + 35); await page.mouse.down();
  await page.mouse.move(pad!.x + 55, pad!.y + 50); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)?.kind)).toBe('move');
  await page.getByRole('button', { name: '鼠标左键', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  await page.getByRole('button', { name: '显示', exact: true }).click();
  await expect(page.getByRole('group', { name: '帧率', exact: true }).getByRole('button', { name: '自动' }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('spinbutton', { name: '自定义帧率' }).fill('45');
  await page.getByRole('button', { name: '应用帧率' }).click();
  await page.getByRole('button', { name: '高清', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.settings.at(-1)))
    .toEqual({ fps: 45, quality: 'clear' });
  const panelWidth = await page.getByRole('complementary', { name: '显示设置' }).evaluate(node => node.clientWidth);
  expect(panelWidth).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('remote-desktop-display.png') });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '键盘', exact: true }).click();
  await page.getByRole('textbox', { name: '发送到电脑的文字' }).fill('你好，远程桌面');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'text', text: '你好，远程桌面' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
  expect(await page.evaluate(() => window.desktopTest.maxConcurrent)).toBe(1);
  expect(errors).toEqual([]);
});
