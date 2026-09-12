import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, apiUrl, output, prepare, serverState, waitFor, waitText, tap, tapNode, input,
  screenshot, hasText, nodes } from './android-chat-driver.mjs';

const report = { startedAt: new Date().toISOString(), passed: false, cases: [] };
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const PAUSE_REPLY = '暂停生成';
const visible = (node) => node.rect[2] > node.rect[0] && node.rect[3] > node.rect[1];
const historyMessages = (current) => current.filter((node) => visible(node) && node.text?.startsWith('历史消息'));
const latestVisible = async () => historyMessages(await nodes()).some((node) => node.text.startsWith('历史消息 35'));
const composer = (current) => current.find((node) => node['content-desc'] === '聊天消息');

function composerHeight(current) {
  const field = composer(current);
  const add = current.find((node) => node['content-desc'] === '添加内容');
  assert.ok(field && add, 'Composer field and add control are visible');
  return Math.max(field.rect[3], add.rect[3]) - Math.min(field.rect[1], add.rect[1]);
}

async function fixtureAction(route, data) {
  const response = await fetch(`${apiUrl}/test/${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(response.ok, true);
}

async function keyboardVisible() {
  return /mInputShown=true/.test(await adb('shell', 'dumpsys', 'input_method'));
}

async function closeKeyboard() {
  assert.equal(await keyboardVisible(), true, 'Keyboard is open before dismissing it');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(async () => !(await keyboardVisible()), 'keyboard closes');
  await pause(350);
}

async function openKeyboard() {
  await tapNode(composer(await nodes()));
  await waitFor(keyboardVisible, 'keyboard opens');
  await pause(350);
}

function assertSameAnchor(before, after) {
  const current = after.find((node) => node.text === before.text);
  assert.ok(current, 'The message being read remains visible');
  assert.ok(Math.abs(current.rect[1] - before.rect[1]) <= 3, 'The reading position stays stable');
  return current.rect[1] - before.rect[1];
}

async function latestMessageCycles(name) {
  const before = await nodes();
  const closedHeight = composerHeight(before);
  const latest = historyMessages(before).find((node) => node.text.startsWith('历史消息 35'));
  assert.ok(latest, 'Latest message is visible before opening the keyboard');
  for (let cycle = 0; cycle < 3; cycle++) {
    await openKeyboard();
    const opened = await nodes();
    const openedHeight = composerHeight(opened);
    assert.equal(openedHeight, closedHeight, 'Opening the keyboard does not change the composer layout height');
    const last = historyMessages(opened).find((node) => node.text.startsWith('历史消息 35'));
    assert.ok(last, 'Latest message remains visible above the keyboard');
    assert.ok(last.rect[3] <= composer(opened).rect[1], 'Latest message is above the composer');
    await closeKeyboard();
    const delta = assertSameAnchor(latest, historyMessages(await nodes()));
    report.cases.push({ name, cycle, anchorDeltaPixels: delta, composerHeightPixels: openedHeight });
  }
  await screenshot(name);
}

async function swipeHistory(older) {
  const list = (await nodes()).find((node) => node.scrollable === 'true');
  assert.ok(list, 'Chat history is scrollable');
  const [left, top, right, bottom] = list.rect;
  const x = String(Math.round((left + right) / 2));
  await adb('shell', 'input', 'swipe', x, String(older ? top + 80 : bottom - 80),
    x, String(older ? bottom - 80 : top + 80), '350');
  await pause(500);
}

async function readingHistory() {
  await swipeHistory(true);
  const before = historyMessages(await nodes());
  const anchor = before.find((node) => node.rect[1] > 340 && node.rect[3] < 1000);
  assert.ok(anchor, 'An older message is fully visible in the upper portion of the list');
  assert.equal(await latestVisible(), false, 'Reading older history disables latest-message following');
  for (let cycle = 0; cycle < 2; cycle++) {
    await openKeyboard();
    const openingDelta = assertSameAnchor(anchor, historyMessages(await nodes()));
    await closeKeyboard();
    const closingDelta = assertSameAnchor(anchor, historyMessages(await nodes()));
    report.cases.push({ name: 'older-history', cycle, openingDeltaPixels: openingDelta,
      closingDeltaPixels: closingDelta });
  }
  await screenshot('keyboard-older-history');
}

async function streamingWithKeyboard() {
  for (let attempt = 0; attempt < 8 && !(await latestVisible()); attempt++) await swipeHistory(false);
  await swipeHistory(false);
  await openKeyboard();
  await fixtureAction('sidebar', { action: 'start' });
  await waitText(PAUSE_REPLY);
  await waitText('处理中…');
  const current = (await nodes()).filter((node) => node.text?.includes('处理中…')).map((node) => node.text).join('');
  await waitFor(async () => (await nodes()).filter((node) => node.text?.includes('处理中…'))
    .map((node) => node.text).join('') !== current, 'stream grows while keyboard is open');
  assert.equal(await keyboardVisible(), true);
  await screenshot('keyboard-live-output');
  await closeKeyboard();
  await waitText('处理中…');
  await tap(PAUSE_REPLY);
  await waitFor(async () => !(await hasText(PAUSE_REPLY)), 'reply stops');
  assert.deepEqual((await serverState()).streamErrors, []);
  report.cases.push({ name: 'streaming', keyboardStayedOpen: true });
}

try {
  report.device = await prepare();
  await waitText('云端服务器地址');
  await input(0, apiUrl);
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await closeKeyboard();
  await tap('登录并查看');
  await waitText('聊天消息');
  await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'chat connected');
  await fixtureAction('sidebar', { action: 'history-pages' });
  await tap('打开聊天列表');
  await waitText('演示项目');
  await tap('移动端聊天体验');
  await waitText('历史消息 35');
  await latestMessageCycles('keyboard-empty-composer');
  await input('聊天消息', 'Draft keyboard stability');
  await closeKeyboard();
  await latestMessageCycles('keyboard-draft-composer');
  await readingHistory();
  await openKeyboard();
  await adb('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_DEL');
  await closeKeyboard();
  await streamingWithKeyboard();
  report.passed = true;
  console.log('PASS: repeated keyboard transitions, latest messages, older reading position, and active streaming');
} catch (error) {
  report.error = String(error);
  await screenshot('keyboard-regression-failed');
  throw error;
} finally {
  await writeFile(path.join(output, 'keyboard-report.json'), JSON.stringify(report, null, 2));
}
