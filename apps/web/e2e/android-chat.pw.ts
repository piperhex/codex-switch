import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _android, chromium, test, expect, type AndroidDevice, type Page, type APIRequestContext }
  from '@playwright/test';
import { chatJourney } from './chat-journey';
import { state, fixtureUrl, login, useNativeKeyboard } from './chat-helpers';

async function dismissKeyboard(device: AndroidDevice, page: Page) {
  const shown = (await device.shell('dumpsys input_method')).toString().includes('mInputShown=true');
  if (!shown) return;
  await device.shell('input keyevent KEYCODE_BACK');
  await expect.poll(() => page.evaluate(() => (visualViewport?.height ?? innerHeight) >= innerHeight - 1)).toBe(true);
}

async function keyboardAndBackground(device: AndroidDevice, page: Page, request: APIRequestContext) {
  await page.getByRole('textbox', { name: '聊天消息' }).click();
  await page.getByRole('textbox', { name: '聊天消息' }).fill('Android Chrome keyboard check');
  await expect.poll(async () => (await device.shell('dumpsys input_method')).toString().includes('mInputShown=true'))
    .toBe(true);
  await expect.poll(() => page.getByRole('button', { name: '发送消息' }).evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    return bounds.bottom <= (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0);
  })).toBe(true);
  await expect.poll(() => page.locator('.mobile-tabbar').evaluate((bar) => {
    const viewport = window.visualViewport;
    // Android reports fractional CSS pixels; tolerate one pixel of layout rounding.
    return bar.getBoundingClientRect().bottom <= (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0) + 1;
  })).toBe(true);
  await device.screenshot({ path: test.info().outputPath('android-keyboard.png') });
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  await device.shell('input keyevent KEYCODE_HOME');
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  await expect.poll(async () => (await state(request)).connectedMobiles).toBe(0);
  await device.shell('am start -n com.android.chrome/com.google.android.apps.chrome.Main');
  await expect(page.getByRole('status').filter({ hasText: /已直连|通过服务器连接/ }))
    .toBeVisible({ timeout: 16_000 });
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveValue('Android Chrome keyboard check');
}

test('Android Chrome runs the H5 chat journey with the real soft keyboard and background recovery',
  async ({ request }, info) => {
    if (process.env.ANDROID_CHAT_DISPOSABLE !== '1') throw new Error('Use a disposable emulator for this test.');
    const serial = process.env.ANDROID_SERIAL ?? 'emulator-5580';
    if (!serial.startsWith('emulator-')) throw new Error('Only emulator devices are accepted.');
    const device = (await _android.devices()).find((entry) => entry.serial() === serial);
    if (!device) throw new Error('Start the Android emulator before running this test.');
    try {
      await device.shell('am force-stop com.android.chrome');
      await request.post(`${fixtureUrl}/test/reset`);
      await device.shell('am start -a android.intent.action.VIEW -d about:blank com.android.chrome');
      await promisify(execFile)('adb', ['-s', serial, 'forward', 'tcp:19222', 'localabstract:chrome_devtools_remote']);
      // ADB forwarding becomes ready before Chrome has opened its debugging socket.
      await expect.poll(async () => {
        try { return (await fetch('http://127.0.0.1:19222/json/version')).ok; }
        catch { return false; }
      }, { timeout: 15_000 }).toBe(true);
      // Preserve real Android focus and viewport behavior instead of Playwright's desktop overrides.
      const browser = await chromium.connectOverCDP('http://127.0.0.1:19222', { noDefaults: true });
      const context = browser.contexts()[0];
      try {
        await context.addInitScript(() => {
          if (location.origin === 'http://127.0.0.1:1422') localStorage.removeItem('codex-switch.web.session.v1');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        page.setDefaultNavigationTimeout(20_000);
        await page.bringToFront();
        for (const other of context.pages()) if (other !== page) await other.close();
        await login(page);
        useNativeKeyboard(page, () => dismissKeyboard(device, page));
        await chatJourney({ page, request, info, transport: 'either' });
        await keyboardAndBackground(device, page, request);
        await device.screenshot({ path: info.outputPath('android-h5-complete.png') });
        await info.attach('environment', { contentType: 'application/json', body: JSON.stringify({
          serial, model: device.model(), android: (await device.shell('getprop ro.build.version.release')).toString(),
          browser: await page.evaluate(() => navigator.userAgent), fixture: await state(request),
        }, null, 2) });
      } finally {
        await browser.close();
        await promisify(execFile)('adb', ['-s', serial, 'forward', '--remove', 'tcp:19222']);
      }
    } finally { await device.close(); }
  });
