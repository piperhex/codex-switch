import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareHierarchy, hierarchy } from './android-hierarchy.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const output = path.join(root, '.codex-tmp', process.env.ANDROID_CHAT_OUTPUT ?? 'android-chat-regression');
export const apiPort = Number(process.env.CHAT_TEST_API_PORT ?? 1490);
export const apiUrl = `http://127.0.0.1:${apiPort}`;
export const apk = path.join(root, 'apps/native/android/app/build/outputs/apk/release/app-release.apk');
export const serial = process.env.ANDROID_SERIAL ?? 'emulator-5580';
if (!serial.startsWith('emulator-')) throw new Error('This test is restricted to an Android emulator.');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function adb(...args) {
  const { stdout } = await exec('adb', ['-s', serial, ...args], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30_000,
  });
  return stdout.trim();
}

export async function serverState() {
  const response = await fetch(`${apiUrl}/test/state`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Local fixture is unavailable: ${response.status}`);
  return response.json();
}

export async function waitFor(check, label, timeout = 35_000) {
  const started = Date.now();
  do {
    if (await check()) return;
    await pause(400);
  } while (Date.now() - started < timeout);
  throw new Error(`Timed out: ${label}`);
}

function decode(value) {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export async function nodes() {
  const xml = await hierarchy(adb);
  await writeFile(path.join(output, 'latest-ui.xml'), xml);
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => {
    const attributes = [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)];
    const node = Object.fromEntries(attributes.map((attr) => [attr[1], decode(attr[2])]));
    node.rect = [...node.bounds.matchAll(/\d+/g)].map((entry) => Number(entry[0]));
    return node;
  });
}

function visible(node) { return node.rect[2] > node.rect[0] && node.rect[3] > node.rect[1]; }
export async function tapNode(node) {
  if (!node || !visible(node)) throw new Error('No visible target');
  const [left, top, right, bottom] = node.rect;
  await adb('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}

export async function tap(label, options = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await nodes();
    const matches = current.filter((node) =>
      visible(node) && (node.text === label || node['content-desc'] === label));
    const target = options.last ? matches.at(-1) : matches[0];
    if (target) { await tapNode(target); return; }
    if (!options.scroll) break;
    const scroll = current.filter((node) => node.scrollable === 'true' && visible(node)).at(-1);
    if (!scroll) break;
    const [left, top, right, bottom] = scroll.rect;
    const x = String(Math.round((left + right) / 2));
    await adb('shell', 'input', 'swipe', x, String(bottom - 30), x, String(top + 30), '350');
  }
  throw new Error(`Visible control not found: ${label}`);
}

export async function input(target, value) {
  const inputs = (await nodes()).filter((node) => node.class === 'android.widget.EditText');
  const node = typeof target === 'number' ? inputs[target] : inputs.find((entry) => entry['content-desc'] === target);
  await tapNode(node);
  await adb('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A');
  await adb('shell', 'input', 'text', value.replace(/ /g, '%s'));
}

export async function hasText(text) {
  return (await nodes()).some((node) => node.text?.includes(text) || node['content-desc']?.includes(text));
}

export async function waitText(text) { await waitFor(() => hasText(text), text); }

export async function screenshot(name) {
  const { stdout } = await exec('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer', maxBuffer: 16 * 1024 * 1024,
  });
  await writeFile(path.join(output, `${name}.png`), stdout);
}

export async function send(text, { steer = false, dismissKeyboard = true } = {}) {
  const operation = steer ? 'steer' : 'send';
  const count = (await serverState()).operations.filter((entry) => entry.operation === operation).length;
  await input('聊天消息', text);
  await tap(steer ? '补充消息' : '发送消息');
  if (dismissKeyboard) {
    const keyboard = await adb('shell', 'dumpsys', 'input_method');
    // Back navigates away from chat when an image modal has already dismissed the keyboard.
    if (/mInputShown=true/.test(keyboard)) await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  }
  await waitFor(async () => (await serverState()).operations.filter((entry) => entry.operation === operation).length
    === count + 1, `PC received ${operation}`);
}

export async function prepare() {
  if (process.env.ANDROID_CHAT_DISPOSABLE !== '1') {
    throw new Error('Set ANDROID_CHAT_DISPOSABLE=1 for a disposable emulator.');
  }
  await mkdir(output, { recursive: true });
  const fixture = await serverState();
  if (fixture.threads[0]?.id !== 'demo-chat' || fixture.operations.length) {
    throw new Error('Start a fresh local mobile-fixture.mjs before running this test.');
  }
  await waitFor(async () => (await adb('shell', 'getprop', 'sys.boot_completed')) === '1', 'emulator boot');
  await prepareHierarchy({ adb, output });
  await adb('install', '-r', apk);
  // The documented command uses a read-only, disposable emulator; never target a physical phone or normal AVD session.
  await adb('shell', 'pm', 'clear', 'com.codexswitch.mobile');
  if (Number(await adb('shell', 'getprop', 'ro.build.version.sdk')) >= 33) {
    await adb('shell', 'pm', 'grant', 'com.codexswitch.mobile', 'android.permission.POST_NOTIFICATIONS');
  }
  await adb('reverse', `tcp:${apiPort}`, `tcp:${apiPort}`);
  await adb('logcat', '-c');
  await adb('shell', 'am', 'start', '-n', 'com.codexswitch.mobile/.MainActivity');
  return { serial, apk, sha256: createHash('sha256').update(await readFile(apk)).digest('hex'),
    android: await adb('shell', 'getprop', 'ro.build.version.release'),
    api: await adb('shell', 'getprop', 'ro.build.version.sdk'),
    model: await adb('shell', 'getprop', 'ro.product.model') };
}
