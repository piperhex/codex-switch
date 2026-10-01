import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

const MOUSE_IDLE_DELAY = 10_000;

declare global { interface Window { desktopTest: typeof desktopTest } }

async function collapsedMouse(page: Page) {
  await page.goto('e2e/remote-desktop-harness.html?touch');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  const icon = page.getByRole('button', { name: '展开鼠标面板' });
  await expect(icon).toBeVisible({ timeout: MOUSE_IDLE_DELAY + 2500 });
  await expect(page.locator('.rd-cursor')).toHaveCount(0);
  return icon;
}

async function expectCollapsed(page: Page) {
  await expect(page.getByRole('button', { name: '展开鼠标面板' })).toBeVisible();
  await expect(page.locator('.rd-mouse, .rd-cursor')).toHaveCount(0);
  expect(await page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'button'))).toEqual([]);
}

test('drags the idle mouse with pointer capture, stays collapsed on release and expands on click',
  async ({ page }, info) => {
    const icon = await collapsedMouse(page);
    const before = (await icon.boundingBox())!;
    const x = before.x + before.width / 2; const y = before.y + before.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 60, y - 30, { steps: 6 }); await page.mouse.up();
    await expectCollapsed(page);
    const moved = (await icon.boundingBox())!;
    expect(moved.x - before.x).toBeCloseTo(-60, 0);
    expect(moved.y - before.y).toBeCloseTo(-30, 0);
    await page.screenshot({ path: info.outputPath('mouse-icon-dragged.png') });
    await icon.click();
    await expect(page.locator('.rd-mouse')).toBeVisible();
    await expect(page.locator('.rd-cursor')).toBeVisible();
    expect(await page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'button'))).toEqual([]);
  });

test('drags the idle mouse by touch without a synthetic click reopening it, then accepts a tap', async ({ page }) => {
  const icon = await collapsedMouse(page);
  const before = (await icon.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const finger = { id: 1, x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ ...finger, x: finger.x - 50, y: finger.y - 25 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expectCollapsed(page);
  const moved = (await icon.boundingBox())!;
  expect(moved.x - before.x).toBeCloseTo(-50, 0); expect(moved.y - before.y).toBeCloseTo(-25, 0);
  const tap = { ...finger, x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tap] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.rd-mouse')).toBeVisible(); await expect(page.locator('.rd-cursor')).toBeVisible();
  expect(await page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'button'))).toEqual([]);
});

test('keeps cancelled and out-and-back drags collapsed, and still supports keyboard activation', async ({ page }) => {
  const icon = await collapsedMouse(page);
  const bounds = (await icon.boundingBox())!;
  const x = bounds.x + bounds.width / 2; const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - 30, y, { steps: 3 }); await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.up(); await expectCollapsed(page);
  await page.mouse.move(x, y); await page.mouse.down();
  await icon.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up(); await expectCollapsed(page);
  await icon.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.rd-mouse')).toBeVisible(); await expect(page.locator('.rd-cursor')).toBeVisible();
  expect(await page.evaluate(() => window.desktopTest.inputs.filter(input => input.kind === 'button'))).toEqual([]);
});
