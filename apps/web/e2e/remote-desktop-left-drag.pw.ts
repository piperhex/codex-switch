import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

async function openMouse(page: Page) {
  await page.goto('e2e/remote-desktop-harness.html?touch');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  const left = page.getByRole('button', { name: '鼠标左键', exact: true });
  const bounds = (await left.boundingBox())!;
  return { left, x: bounds.x + bounds.width / 3, y: bounds.y + bounds.height / 3 };
}

async function expectReleasedDrag(page: Page) {
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  const inputs = await page.evaluate(() => window.desktopTest.inputs);
  expect(inputs.filter(input => input.kind === 'button')).toEqual([
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
  ]);
  expect(inputs[0]).toEqual({ kind: 'move', x: 0.5, y: 0.5 });
  expect(inputs[1]).toEqual({ kind: 'button', button: 'left', down: true });
  const lastMove = inputs.at(-2);
  expect(lastMove?.kind).toBe('move');
  if (lastMove?.kind === 'move') { expect(lastMove.x).toBeLessThan(0.5); expect(lastMove.y).toBeLessThan(0.5); }
  await expect(page.getByRole('button', { name: '鼠标左键', exact: true })).toHaveAttribute('aria-pressed', 'false');
}

test('drags from the left button with one finger and releases after a long drag', async ({ page }, info) => {
  const { left, x, y } = await openMouse(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ id: 1, x: x - 30, y: y - 20 }],
  });
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  // Holding past the old latch delay must still release when this moving finger lifts.
  await page.waitForTimeout(650);
  await page.screenshot({ path: info.outputPath('left-button-dragging.png') });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ id: 1, x: x - 60, y: y - 35 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expectReleasedDrag(page);
});

test('captures a mouse drag outside the left button after an initial long press', async ({ page }) => {
  const { left, x, y } = await openMouse(page);
  await page.mouse.move(x, y); await page.mouse.down();
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(x - 100, y - 45, { steps: 5 }); await page.mouse.up();
  await expectReleasedDrag(page);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur'] as const) {
  test(`releases a left-button drag on ${interruption}`, async ({ page }) => {
    const { left, x, y } = await openMouse(page);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 35, y - 15, { steps: 3 });
    if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await left.dispatchEvent(interruption, { pointerId: 1 });
    await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
      .toEqual({ kind: 'button', button: 'left', down: false });
    await page.mouse.up();
    expect(await page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'button')))
      .toHaveLength(2);
    await expect(left).toHaveAttribute('aria-pressed', 'false');
  });
}

test('closes the host capture during a drag and reopens without a held left button', async ({ page }) => {
  const { x, y } = await openMouse(page);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 35, y - 15);
  await page.getByRole('button', { name: '关闭', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  // Closing can discard queued data-channel input; native capture teardown releases the host buttons.
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
  await expect(page.locator('.rd-root')).toHaveCount(0); await page.mouse.up();
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  const left = page.getByRole('button', { name: '鼠标左键', exact: true });
  await expect(left).toHaveAttribute('aria-pressed', 'false'); await left.click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.slice(-3))).toEqual([
    { kind: 'move', x: 0.5, y: 0.5 },
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
  ]);
});
