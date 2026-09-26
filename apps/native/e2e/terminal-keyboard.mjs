import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

process.env.ANDROID_CHAT_OUTPUT ??= 'terminal-keyboard-regression';
const driver = await import('../../desktop/e2e/android-chat-driver.mjs');
const { adb, nodes, output, screenshot, tap, tapNode, waitFor, waitText } = driver;
const packageName = 'com.codexswitch.mobile.terminaltest';
const apk = fileURLToPath(new URL('../android/app/build/outputs/apk/release/terminal-fixture.apk', import.meta.url));
const keyboardShown = async () => /mInputShown=true/.test(await adb('shell', 'dumpsys', 'input_method'));
const webviewBounds = async () => (await nodes()).find(node => node.class === 'android.webkit.WebView').rect;
const focusTerminal = async () => tapNode((await nodes()).find(node => node['resource-id'] === 'terminal'));

async function dismissKeyboard() {
  if (await keyboardShown()) await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(async () => !await keyboardShown(), 'keyboard dismissed');
}

async function checkLayout(label) {
  const current = await nodes();
  const terminal = current.find(node => node.class === 'android.webkit.WebView');
  assert.ok(terminal, 'Terminal WebView must remain visible');
  for (const control of ['自动换行', '关闭终端', '收起终端', '终端 1']) {
    const node = current.filter(node => node['content-desc'] === control || node.text === control).at(-1);
    assert.ok(node, `${control} must remain visible after resizing`);
    assert.ok(node.rect[1] >= 0 && node.rect[3] > node.rect[1], `${control} must stay on screen`);
    assert.ok(node.rect[3] <= terminal.rect[1], `${control} must stay above terminal output`);
  }
  assert.ok(terminal.rect[3] > terminal.rect[1], 'Terminal output must have visible space');
  const viewport = current.find(node => node['resource-id'] === 'viewport');
  const density = /(?:Override|Physical) density: (\d+)/g;
  const scale = [...(await adb('shell', 'wm', 'density')).matchAll(density)].at(-1)[1] / 160;
  // Reserve two 17dp text rows plus padding and the horizontal scrollbar.
  assert.ok(viewport && viewport.rect[3] - viewport.rect[1] >= 46 * scale,
    'The current command needs at least two complete terminal rows');
  await screenshot(label);
}

async function checkKeyboard(label) {
  const original = await webviewBounds();
  await focusTerminal();
  await waitFor(keyboardShown, 'keyboard shown');
  await adb('shell', 'input', 'text', 'keyboard_probe');
  const windows = await adb('shell', 'dumpsys', 'window');
  const keyboard = /type=ime frame=\[\d+,(\d+)\]\[\d+,\d+\][^\r\n]*visible=true/.exec(windows);
  assert.ok(keyboard, 'Visible keyboard bounds must be reported (Android API 35)');
  const keyboardTop = Number(keyboard[1]);
  const current = await nodes();
  const terminal = current.find(node => node.class === 'android.webkit.WebView');
  const shortcut = current.find(node => node['content-desc'] === 'Ctrl+C' || node.text === 'Ctrl+C');
  await checkLayout(label);
  assert.ok(shortcut, 'Terminal shortcuts must remain visible with the keyboard open');
  assert.ok(shortcut.rect[3] <= keyboardTop, 'Terminal shortcuts must fit above the keyboard');
  assert.ok(terminal.rect[3] <= keyboardTop, 'The whole terminal must fit above the keyboard');
  assert.ok(terminal.rect[3] - terminal.rect[1] < original[3] - original[1], 'Terminal height must shrink');
  await dismissKeyboard();
  await waitFor(async () => (await webviewBounds())[3] === original[3], 'terminal height restored');
  await checkLayout(`${label}-restored`);
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
  await checkLayout('landscape-before-keyboard');
  await focusTerminal();
  await waitFor(keyboardShown, 'keyboard shown before landscape shortcut');
  await tap('Ctrl+C');
  assert.ok(await keyboardShown(), 'Landscape shortcuts must keep the keyboard open');
  await checkLayout('landscape-shortcut');
  await dismissKeyboard();
  await checkKeyboard('landscape');
  await tap('自动换行');
  await checkKeyboard('landscape-wrap');
  await tap('切换竖屏');
  await waitText('切换横屏');
  await focusTerminal();
  await waitFor(keyboardShown, 'keyboard shown before rotating');
  await tap('切换横屏');
  await waitText('切换竖屏');
  // Android may retain the WebView's keyboard focus across rotation; either state must fit.
  await checkLayout('landscape-after-typing');
  await dismissKeyboard();
  await tap('切换竖屏');
  await waitText('切换横屏');
  await focusTerminal();
  await waitFor(keyboardShown, 'keyboard shown before hiding');
  await tap('收起终端', { last: true });
  await waitText('Opened 1, closed 0');
  // Android quotes this JSON text with single quotes, which the shared node parser does not read.
  const inputHierarchy = await readFile(`${output}/latest-ui.xml`, 'utf8');
  assert.ok(inputHierarchy.includes(JSON.stringify('\x03').slice(1, -1)),
    'The native landscape shortcut must reach the existing shell');
  await tap('打开远程终端');
  await waitText('Ctrl+C');
  await checkKeyboard('reopened');
  await tap('收起终端', { last: true });
  await waitText('Opened 1, closed 0');
  await tap('Switch project');
  await waitText('Project /other');
  await tap('打开远程终端');
  // Xterm's rendered rows are hidden from the accessibility tree; verify the attached session's native header.
  await waitText('Office · /other');
  assert.ok(!(await nodes()).some(node => node.text === 'Office · /project'),
    'Previous project session must be hidden');
  await screenshot('other-project');
  await tap('收起终端', { last: true });
  await waitText('Opened 2, closed 0');
  await tap('Switch project');
  await tap('打开远程终端');
  await waitText('Office · /project');
  await screenshot('restored-project');
  await tap('关闭终端');
  await waitText('Opened 2, closed 1');
  await tap('Switch project');
  await tap('打开远程终端');
  await waitText('Office · /other');
  await tap('收起终端', { last: true });
  await waitText('Opened 2, closed 1');
  console.log('PASS project isolation and explicit close');
} catch (error) {
  await screenshot('failure');
  throw error;
} finally {
  await adb('shell', 'am', 'force-stop', packageName);
}
