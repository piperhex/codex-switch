import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Terminal } from '@xterm/xterm';

declare const terminal: Terminal;
interface TerminalHost extends Window {
  messages: string[];
  remoteTerminal: (event: object) => void;
  ReactNativeWebView: { postMessage: (data: string) => void };
}
const longLine = `LONG_START_${'0123456789'.repeat(12)}_LONG_END`;

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Native phone terminal');
  const html = readFileSync(new URL('../../native/assets/terminal.html', import.meta.url), 'utf8');
  await page.addInitScript(() => {
    const host = window as unknown as TerminalHost;
    host.messages = [];
    host.ReactNativeWebView = { postMessage: data => host.messages.push(data) };
  });
  await page.route('**/native-terminal.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('native-terminal.html');
  await expect.poll(() => page.evaluate(() => terminal.cols)).toBeLessThan(50);
});

async function output(page: Page, data: string) {
  await page.evaluate(value => new Promise<void>(resolve => {
    terminal.write(new TextEncoder().encode(value), resolve);
  }), data);
}
async function wrap(page: Page, enabled: boolean) {
  await page.evaluate(value => (window as unknown as TerminalHost).remoteTerminal({ type: 'display', wrap: value }), enabled);
  if (enabled) await expect.poll(() => page.evaluate(() => terminal.cols)).toBeLessThan(50);
  else await expect.poll(() => page.evaluate(() => terminal.cols)).toBe(500);
}
async function swipe(page: Page, delta: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  const start = { x: delta.x < 0 ? 340 : 60, y: delta.y < 0 ? 550 : 200 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let step = 1; step <= 12; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: start.x + delta.x * step / 12, y: start.y + delta.y * step / 12 },
    ] });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test('wraps complete long lines within the viewport and reflows when rotating or opening the keyboard', async ({ page }) => {
  await output(page, `${longLine}\r\n$ `);
  await expect(page.locator('.xterm-rows')).toContainText('LONG_END');
  const size = () => page.evaluate(() => {
    const bounds = document.querySelector('.xterm-screen')!.getBoundingClientRect();
    return { right: bounds.right, bottom: bounds.bottom,
      keysTop: document.querySelector('nav')!.getBoundingClientRect().top, cols: terminal.cols, rows: terminal.rows };
  });
  const portrait = await size();
  expect(portrait.right).toBeLessThanOrEqual(390);
  expect(portrait.bottom).toBeLessThanOrEqual(portrait.keysTop);
  await expect(page.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await size()).cols).toBeGreaterThan(portrait.cols);
  await expect(page.locator('.xterm-rows')).toContainText('LONG_END');
  await page.setViewportSize({ width: 390, height: 300 });
  await expect.poll(async () => (await size()).right).toBeLessThanOrEqual(390);
  await expect.poll(async () => (await size()).rows).toBeLessThan(portrait.rows);
  const keyboard = await size();
  expect(keyboard.right).toBeLessThanOrEqual(390);
  expect(keyboard.bottom).toBeLessThanOrEqual(keyboard.keysTop);
  await expect(page.locator('.xterm-rows')).toContainText('LONG_END');
});

test('scrolls history with vertical touch gestures without moving the page or sending terminal input', async ({ page }) => {
  await output(page, Array.from({ length: 150 }, (_, index) => `History ${index}`).join('\r\n') + '\r\n$ ');
  const last = await page.evaluate(() => terminal.buffer.active.viewportY);
  await swipe(page, { x: 0, y: 220 });
  await expect.poll(() => page.evaluate(() => terminal.buffer.active.viewportY)).toBeLessThan(last);
  await page.waitForTimeout(1000);
  const earlier = await page.evaluate(() => terminal.buffer.active.viewportY);
  await swipe(page, { x: 0, y: -220 });
  await expect.poll(() => page.evaluate(() => terminal.buffer.active.viewportY)).toBeGreaterThan(earlier);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator('#viewport').evaluate(element => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as TerminalHost).messages
    .map(raw => JSON.parse(raw) as { type: string }).filter(value => value.type === 'input'))).toHaveLength(0);
});

for (const enabled of [true, false]) {
  test(`keeps the current command above the keyboard with wrapping ${enabled}`, async ({ page }) => {
    await wrap(page, enabled);
    const command = '$ echo keyboard-visible';
    const history = Array.from({ length: 120 }, (_, index) => `History ${index}`).join('\r\n');
    await output(page, `${history}\r\n${command}`);
    const originalRows = await page.evaluate(() => terminal.rows);
    for (const height of [300, 240, 96, 844]) {
      const previousRows = await page.evaluate(() => terminal.rows);
      await page.setViewportSize({ width: 390, height });
      const rows = expect.poll(() => page.evaluate(() => terminal.rows));
      if (height === 844) await rows.toBe(originalRows);
      else await rows.toBeLessThan(previousRows);
      await expect(page.locator('.xterm-rows')).toContainText(command);
      const position = await page.evaluate(() => {
        const buffer = terminal.buffer.active;
        const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect();
        return { cursorRow: buffer.baseY + buffer.cursorY - buffer.viewportY, rows: terminal.rows,
          bottom: screen.bottom, keysTop: document.querySelector('nav')!.getBoundingClientRect().top };
      });
      expect(position.cursorRow).toBeGreaterThanOrEqual(0);
      expect(position.cursorRow).toBeLessThan(position.rows);
      expect(position.bottom).toBeLessThanOrEqual(position.keysTop);
    }
  });
}

test('keeps a long line intact for horizontal touch panning and switches back without losing output', async ({ page }) => {
  await wrap(page, false);
  await output(page, `${longLine}\r\n$ `);
  expect(await page.evaluate(() => terminal.buffer.active.getLine(0)?.translateToString(true))).toBe(longLine);
  const viewport = page.locator('#viewport');
  await swipe(page, { x: -260, y: 0 });
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(150);
  expect(await page.evaluate(() => terminal.buffer.active.viewportY)).toBe(0);
  await swipe(page, { x: 260, y: 0 });
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeLessThan(150);
  await wrap(page, true);
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(0);
  expect(await viewport.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator('.xterm-rows')).toContainText('LONG_END');
  await wrap(page, false);
  expect(await page.evaluate(() => terminal.buffer.active.getLine(0)?.translateToString(true))).toBe(longLine);
});

test('leaves command rows visible when native landscape shortcuts move into the header', async ({ page }) => {
  const command = '$ echo landscape-visible';
  await output(page, `${Array.from({ length: 120 }, (_, index) => `History ${index}`).join('\r\n')}\r\n${command}`);
  await page.setViewportSize({ width: 844, height: 96 });
  await page.evaluate(() => (window as unknown as TerminalHost)
    .remoteTerminal({ type: 'display', wrap: true, shortcuts: false }));
  await expect(page.locator('nav')).toBeHidden();
  await expect(page.locator('.xterm-rows > div').filter({ hasText: command })).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => (window as unknown as TerminalHost).remoteTerminal({ type: 'key', data: '\x03' }));
  await expect.poll(() => page.evaluate(() => (window as unknown as TerminalHost).messages
    .map(raw => JSON.parse(raw) as { type: string; data?: string }).filter(message => message.type === 'input')))
    .toContainEqual({ type: 'input', data: '\x03' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (window as unknown as TerminalHost)
    .remoteTerminal({ type: 'display', wrap: true, shortcuts: true }));
  await expect(page.getByRole('button', { name: 'Ctrl+C', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.xterm-rows')).toContainText(command);
});
