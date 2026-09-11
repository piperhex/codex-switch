import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, screenshot, hasText, nodes }
  from './android-chat-driver.mjs';

const fixture = 'http://127.0.0.1:1490/test';
async function action(route, data) {
  const result = await fetch(`${fixture}/${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(result.ok, true);
}

async function swipe(older) {
  const scroll = (await nodes()).find((node) => node.scrollable === 'true');
  assert.ok(scroll, 'Chat list is scrollable');
  const [left, top, right, bottom] = scroll.rect;
  const x = String(Math.round((left + right) / 2));
  const start = String(older ? top + 80 : bottom - 80);
  const end = String(older ? bottom - 80 : top + 80);
  await adb('shell', 'input', 'swipe', x, start, x, end, '350');
}

async function olderPage(expected) {
  console.log(`Checking the next ${expected} older messages`);
  const before = (await serverState()).synchronization.length;
  const loaded = async () => (await serverState()).synchronization.slice(before).some((entry) => entry.changedItems > 0);
  for (let index = 0; index < 6 && !(await loaded()); index++) await swipe(true);
  await waitText('正在加载聊天记录');
  await screenshot(`history-loading-${expected}`);
  const anchor = (await nodes()).find((node) => node.text?.startsWith('历史消息'));
  await waitFor(async () => !(await hasText('正在加载聊天记录')), 'older page finished');
  const updates = (await serverState()).synchronization.slice(before).filter((entry) => entry.changedItems > 0);
  assert.deepEqual(updates.map((entry) => entry.changedItems), [expected]);
  if (anchor) {
    const after = (await nodes()).find((node) => node.text === anchor.text);
    assert.ok(after, 'The message being read stays visible after loading');
    assert.ok(Math.abs(after.rect[1] - anchor.rect[1]) < 12, 'The reading position stays stable');
  }
}

const report = { startedAt: new Date().toISOString(), passed: false };
try {
  report.device = await prepare();
  await waitText('云端服务器地址');
  await input(0, 'http://127.0.0.1:1490');
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitText('账户管理');
  await tap('聊天', { last: true });
  await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'chat connected');
  await action('sidebar', { action: 'history-pages' });
  await action('history-delay', { milliseconds: 5000 });
  await tap('打开聊天列表');
  await waitText('演示项目');
  await tap('移动端聊天体验');
  await waitText('历史消息 35');
  console.log('Newest message is visible after opening the conversation');
  assert.equal((await serverState()).synchronization[0].changedItems, 10);
  await screenshot('history-latest-ten');
  for (const expected of [10, 10, 5]) await olderPage(expected);
  await action('history-delay', { milliseconds: 0 });
  for (let index = 0; index < 15 && !(await hasText('历史消息 35')); index++) await swipe(false);
  await action('sidebar', { action: 'start' });
  console.log('Checking streamed output and the processing timer');
  await waitText('停止回复');
  await waitFor(async () => (await nodes()).some((node) =>
    Number(node.text?.match(/正在处理 · (\d+)秒/)?.[1]) >= 2), 'processing timer');
  await waitText('处理中…');
  const currentText = (await nodes()).filter((node) => node.text?.includes('处理中…')).map((node) => node.text).join('');
  await waitFor(async () => (await nodes()).filter((node) => node.text?.includes('处理中…'))
    .map((node) => node.text).join('') !== currentText, 'stream grows before completion');
  assert.equal((await serverState()).threads[0].turns.at(-1).status, 'inProgress');
  await screenshot('history-stream-and-seconds');
  await swipe(true);
  const visible = await nodes();
  const timer = visible.find((node) => /正在处理 · \d+秒/.test(node.text));
  const composer = visible.find((node) => node['content-desc'] === '聊天消息');
  assert.ok(timer && composer && timer.rect[3] > timer.rect[1] && timer.rect[3] <= composer.rect[1],
    'Processing seconds remain visible above the composer while reading older messages');
  await tap('停止回复');
  await waitFor(async () => !(await hasText('正在处理 ·')), 'processing timer removed');
  assert.deepEqual((await serverState()).streamErrors, []);
  report.passed = true;
  console.log('PASS: latest ten, older pages, loading indicator, scroll position, live output, processing seconds');
} catch (error) {
  report.error = String(error);
  await screenshot('history-regression-failed');
  throw error;
} finally {
  await writeFile(path.join(output, 'history-report.json'), JSON.stringify(report, null, 2));
}
