import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

process.env.ANDROID_CHAT_OUTPUT ??= 'terminal-keyboard-regression';
const driver = await import('../../desktop/e2e/android-chat-driver.mjs');
const { adb, nodes, output, screenshot, tap, waitFor, waitText } = driver;
const packageName = 'com.codexswitch.mobile.terminaltest';
const apk = fileURLToPath(new URL('../android/app/build/outputs/apk/release/terminal-fixture.apk', import.meta.url));
const keyboardShown = async () => /mInputShown=true/.test(await adb('shell', 'dumpsys', 'input_method'));
const webviewBounds = async () => (await nodes()).find(node => node.class === 'android.webkit.WebView').rect;

async function dismissKeyboard() {
  if (await keyboardShown()) await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(async () => !await keyboardShown(), 'keyboard dismissed');
}

async function checkKeyboard(label) {
  const original = await webviewBounds();
  await tap('终端');
  await waitFor(keyboardShown, 'keyboard shown');
  await adb('shell', 'input', 'text', 'keyboard_probe');
  const windows = await adb('shell', 'dumpsys', 'window');
  const keyboard = /type=ime frame=\[\d+,(\d+)\]\[\d+,\d+\][^\r\n]*visible=true/.exec(windows);
  assert.ok(keyboard, 'Visible keyboard bounds must be reported (Android API 35)');
  const keyboardTop = Number(keyboard[1]);
  const current = await nodes();
  const terminal = current.find(node => node.class === 'android.webkit.WebView');
  const shortcut = current.find(node => node.text === 'Ctrl+C');
  await screenshot(label);
  assert.ok(shortcut, 'Terminal shortcuts must remain visible with the keyboard open');
  assert.ok(shortcut.rect[3] <= keyboardTop, 'Terminal shortcuts must fit above the keyboard');
  assert.ok(terminal.rect[3] <= keyboardTop, 'The whole terminal must fit above the keyboard');
  assert.ok(terminal.rect[3] - terminal.rect[1] < original[3] - original[1], 'Terminal height must shrink');
  await dismissKeyboard();
  await waitFor(async () => (await webviewBounds())[3] === original[3], 'terminal height restored');
  console.log(`PASS ${label}`);
}

try {
  await mkdir(output, { recursive: true });
  await prepareHierarchy(driver);
  if (!process.argv.includes('--installed')) await adb('install', '-r', apk);
  await adb('shell', 'am', 'force-stop', packageName);
  await adb('shell', 'am', 'start', '-n', `${packageName}/com.codexswitch.mobile.MainActivity`);
  await waitText('打开远程终端');
  await tap('打开远程终端');
  await waitText('Ctrl+C');
  await checkKeyboard('portrait-wrap');
  await tap('自动换行');
  await checkKeyboard('portrait-no-wrap');
  await tap('切换横屏');
  await waitText('切换竖屏');
  await checkKeyboard('landscape');
  await tap('切换竖屏');
  await waitText('切换横屏');
  await tap('终端');
  await waitFor(keyboardShown, 'keyboard shown before hiding');
  await tap('收起终端', { last: true });
  await waitText('Opened 1, closed 0');
  await tap('打开远程终端');
  await waitText('Ctrl+C');
  await checkKeyboard('reopened');
  await tap('收起终端', { last: true });
  await waitText('Opened 1, closed 0');
} catch (error) {
  await screenshot('failure');
  throw error;
} finally {
  await adb('shell', 'am', 'force-stop', packageName);
}
