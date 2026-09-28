import { expect, test, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true });
async function open(page: Page, suffix = '') {
  await page.goto(`e2e/remote-desktop-harness.html${suffix}`);
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '展开滚动滑块' }).click();
  await expect(page.getByRole('group', { name: '十字滚动滑块' })).toBeVisible();
  await page.evaluate(() => { window.desktopTest.inputs.length = 0; });
  const box = (await page.locator('.rd-scroll-pad').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
const wheels = (page: Page) => page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'wheel'));

test('opens the cross from the wheel, scrolls all directions, recenters on release and dismisses without a remote click',
  async ({ page }, info) => {
    const center = await open(page);
    const video = await page.locator('video').boundingBox();
    const cursor = await page.locator('.rd-cursor').boundingBox();
    await page.screenshot({ path: info.outputPath('scroll-cross.png') });
    for (const [x, y, delta, horizontal] of [
      [0, -60, 120, false], [0, 60, -120, false], [-60, 0, -120, true], [60, 0, 120, true],
    ] as const) {
      await page.mouse.move(center.x, center.y); await page.mouse.down();
      await page.mouse.move(center.x + x, center.y + y);
      await expect.poll(async () => (await wheels(page)).at(-1))
        .toEqual({ kind: 'wheel', delta, ...(horizontal ? { horizontal } : {}) });
      const before = (await wheels(page)).length;
      await expect.poll(async () => (await wheels(page)).length).toBeGreaterThan(before);
      await page.mouse.up(); await page.waitForTimeout(100);
      const after = (await wheels(page)).length; await page.waitForTimeout(200);
      expect((await wheels(page)).length).toBe(after);
      const knob = (await page.locator('.rd-scroll-knob').boundingBox())!;
      expect(knob.x + knob.width / 2).toBeCloseTo(center.x, 0);
      expect(knob.y + knob.height / 2).toBeCloseTo(center.y, 0);
    }
    expect(await page.locator('video').boundingBox()).toEqual(video);
    expect(await page.locator('.rd-cursor').boundingBox()).toEqual(cursor);
    await page.mouse.click(center.x, center.y);
    await expect(page.getByRole('button', { name: '展开滚动滑块' })).toBeVisible();
    expect(await page.evaluate(() => window.desktopTest.inputs.some(input => input.kind === 'button'))).toBe(false);
  });

test('keeps the cross inside the viewport and cancels scrolling on blur and mode changes', async ({ page }) => {
  const center = await open(page);
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  const cross = (await page.locator('.rd-scroll-pad').boundingBox())!;
  expect(cross.x).toBeGreaterThanOrEqual(stage.x); expect(cross.y).toBeGreaterThanOrEqual(stage.y);
  expect(cross.x + cross.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(cross.y + cross.height).toBeLessThanOrEqual(stage.y + stage.height);
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x, center.y + 60);
  await expect.poll(async () => (await wheels(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
  await page.waitForTimeout(100); const count = (await wheels(page)).length; await page.waitForTimeout(200);
  expect((await wheels(page)).length).toBe(count);
  await page.getByRole('button', { name: '切换为触屏模式' }).click();
  await expect(page.locator('.rd-scroll-pad')).toHaveCount(0);
  await page.getByRole('button', { name: '切换为鼠标模式' }).click();
  await expect(page.getByRole('button', { name: '展开滚动滑块' })).toBeVisible();
});

test('keeps vertical scrolling available on older hosts and explains the horizontal update', async ({ page }) => {
  const center = await open(page, '?legacy');
  await expect(page.getByText('更新远程电脑上的应用后，即可左右滚动。')).toBeVisible();
  await page.mouse.click(center.x + 60, center.y); await page.waitForTimeout(150);
  expect(await wheels(page)).toEqual([]);
  await page.mouse.click(center.x, center.y - 60);
  await expect.poll(async () => (await wheels(page)).at(-1)).toEqual({ kind: 'wheel', delta: 120 });
});
