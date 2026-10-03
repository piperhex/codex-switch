import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, suffix = '') {
  await page.goto(`e2e/remote-desktop-harness.html?touch&${suffix}`);
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
}
async function pressWheel(page: Page) {
  const box = (await page.getByRole('button', { name: '按住并拖动以滚动' }).boundingBox())!;
  const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(origin.x, origin.y); await page.mouse.down();
  await expect(page.getByRole('group', { name: '十字滚动滑块' })).toBeVisible();
  await expect(page.locator('.rd-mouse-layer')).toHaveCSS('opacity', '0');
  return origin;
}
const wheels = (page: Page) => page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'wheel'));
async function expectStopped(page: Page) {
  await expect(page.locator('.rd-scroll-pad')).toHaveCount(0);
  await expect(page.locator('.rd-mouse-layer')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('button', { name: '按住并拖动以滚动' })).toBeVisible();
  await page.waitForTimeout(100);
  const count = (await wheels(page)).length; await page.waitForTimeout(200);
  expect((await wheels(page)).length).toBe(count);
}

test('scrolls all directions in one hold per gesture and restores the mouse immediately on release',
  async ({ page }, info) => {
    await open(page);
    const video = await page.locator('video').boundingBox();
    const cursor = await page.locator('.rd-cursor').boundingBox();
    for (const [x, y, delta, horizontal] of [
      [0, -60, 120, false], [0, 60, -120, false], [-60, 0, -120, true], [60, 0, 120, true],
    ] as const) {
      const origin = await pressWheel(page);
      await page.mouse.move(origin.x + x, origin.y + y);
      await expect.poll(async () => (await wheels(page)).at(-1))
        .toEqual({ kind: 'wheel', delta, ...(horizontal ? { horizontal } : {}) });
      const before = (await wheels(page)).length;
      await expect.poll(async () => (await wheels(page)).length).toBeGreaterThan(before);
      if (y === 60) await page.screenshot({ path: info.outputPath('held-scroll-cross.png') });
      await page.mouse.up(); await expectStopped(page);
    }
    expect(await page.locator('video').boundingBox()).toEqual(video);
    expect(await page.locator('.rd-cursor').boundingBox()).toEqual(cursor);
    expect(await page.evaluate(() => window.desktopTest.inputs.some(input => input.kind === 'button'))).toBe(false);
  });

test('does not latch the cross open or scroll when the center button is tapped', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '按住并拖动以滚动' }).click();
  await expectStopped(page); expect(await wheels(page)).toEqual([]);
  expect(await page.evaluate(() => window.desktopTest.inputs)).toEqual([]);
});

test('uses the original finger from the wheel through dragging and lifting', async ({ page }) => {
  await open(page);
  const box = (await page.getByRole('button', { name: '按住并拖动以滚动' }).boundingBox())!;
  const finger = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
  await expect(page.locator('.rd-scroll-pad')).toBeVisible(); expect(await wheels(page)).toEqual([]);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ ...finger, y: finger.y - 60 }],
  });
  await expect.poll(async () => (await wheels(page)).at(-1)).toEqual({ kind: 'wheel', delta: 120 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await expectStopped(page);
  expect(await page.evaluate(() => window.desktopTest.inputs.some(input => input.kind === 'button'))).toBe(false);
});

for (const reason of ['blur', 'pointercancel', 'lostpointercapture', 'mode', 'resize'] as const) {
  test(`restores the mouse and stops scrolling on ${reason}`, async ({ page }) => {
    await open(page); const origin = await pressWheel(page);
    const stage = (await page.locator('.rd-stage').boundingBox())!;
    const cross = (await page.locator('.rd-scroll-pad').boundingBox())!;
    expect(cross.x).toBeGreaterThanOrEqual(stage.x); expect(cross.y).toBeGreaterThanOrEqual(stage.y);
    expect(cross.x + cross.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(cross.y + cross.height).toBeLessThanOrEqual(stage.y + stage.height);
    await page.mouse.move(origin.x, origin.y + 60);
    await expect.poll(async () => (await wheels(page)).length).toBeGreaterThan(0);
    if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else if (reason === 'mode') {
      await page.getByRole('button', { name: '切换为触屏模式' })
        .evaluate((button: HTMLButtonElement) => button.click());
    } else if (reason === 'resize') await page.setViewportSize({ width: 800, height: 600 });
    else await page.locator('.rd-wheel').dispatchEvent(reason, { pointerId: 1 });
    await expect(page.locator('.rd-scroll-pad')).toHaveCount(0); await page.mouse.up();
    if (reason === 'mode') await page.getByRole('button', { name: '切换为鼠标模式' }).click();
    await expectStopped(page);
  });
}

test('keeps vertical dragging available on older hosts and explains the horizontal update', async ({ page }) => {
  await open(page, 'legacy');
  let origin = await pressWheel(page);
  await expect(page.getByText('更新远程电脑上的应用后，即可左右滚动。')).toBeVisible();
  await page.mouse.move(origin.x + 60, origin.y); await page.waitForTimeout(150);
  expect(await wheels(page)).toEqual([]); await page.mouse.up(); await expectStopped(page);
  origin = await pressWheel(page);
  await page.mouse.move(origin.x, origin.y - 60);
  await expect.poll(async () => (await wheels(page)).at(-1)).toEqual({ kind: 'wheel', delta: 120 });
  await page.mouse.up(); await expectStopped(page);
});
