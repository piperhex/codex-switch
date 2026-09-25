import { expect, test, type Page } from '@playwright/test';
import { connect, fixtureUrl, login, navigate, screenshot } from './chat-helpers';

interface ViewportSize { height: number; offsetTop: number }

async function resizeVisualViewport(page: Page, size: ViewportSize, delayed = false) {
  await page.evaluate(({ size, delayed }) => {
    const viewport = window.visualViewport!;
    const resize = () => {
      Object.defineProperty(viewport, 'height', { configurable: true, value: size.height });
      Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: size.offsetTop });
    };
    if (delayed) {
      // Safari can dispatch resize before publishing the keyboard's final geometry.
      viewport.dispatchEvent(new Event('resize'));
      queueMicrotask(resize);
    } else {
      resize();
      viewport.dispatchEvent(new Event('resize'));
    }
  }, { size, delayed });
}

async function expectComposerWithinViewport(page: Page, size: ViewportSize) {
  await expect.poll(() => page.locator('.app-shell').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, offsetTop: bounds.top };
  })).toEqual(size);
  const input = (await page.getByRole('textbox', { name: '聊天消息' }).boundingBox())!;
  const send = (await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox())!;
  expect(input.y).toBeGreaterThanOrEqual(size.offsetTop);
  expect(input.y + input.height).toBeLessThanOrEqual(size.offsetTop + size.height);
  expect(send.y + send.height).toBeLessThanOrEqual(size.offsetTop + size.height);
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await login(page);
  await expect(page.getByText('欢迎回来', { exact: true })).toBeVisible();
  await connect(page);
});

test('keeps the composer above the keyboard when Safari publishes viewport geometry after resize',
  async ({ page }, info) => {
    const input = page.getByRole('textbox', { name: '聊天消息' });
    await input.fill('保留正在输入的内容');
    const keyboard = { height: 460, offsetTop: 0 };
    await resizeVisualViewport(page, keyboard, true);
    await expectComposerWithinViewport(page, keyboard);
    const panned = { height: 420, offsetTop: 35 };
    await resizeVisualViewport(page, panned, true);
    await expectComposerWithinViewport(page, panned);
    await expect(input).toHaveValue('保留正在输入的内容');
    await screenshot(page, info, 'keyboard-visible');
    await input.blur();
    const restored = { height: page.viewportSize()!.height, offsetTop: 0 };
    await resizeVisualViewport(page, restored, true);
    await expectComposerWithinViewport(page, restored);
  });

test('keeps the composer visible when only the visual viewport shrinks', async ({ page }) => {
  const layoutHeight = await page.evaluate(() => innerHeight);
  const keyboard = { height: 460, offsetTop: 0 };
  await resizeVisualViewport(page, keyboard);
  await expectComposerWithinViewport(page, keyboard);
  expect(await page.evaluate(() => innerHeight)).toBe(layoutHeight);
  await navigate(page, '账号');
  // Pending keyboard frames must not restore chat sizing after leaving the page.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--chat-height'))).toBe('');
});

test('follows keyboard animation after focus even without another viewport event', async ({ page }) => {
  // Let the initial mount synchronization finish before testing a fresh focus event.
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: '聊天消息' }).focus();
  const keyboard = { height: 440, offsetTop: 20 };
  await page.evaluate(size => new Promise<void>(resolve => {
    window.setTimeout(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: size.height });
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: size.offsetTop });
      resolve();
    }, 100);
  }), keyboard);
  await expectComposerWithinViewport(page, keyboard);
});
