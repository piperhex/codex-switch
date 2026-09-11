import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, screenshot, hasText }
  from './android-chat-driver.mjs';

async function action(route, data) {
  const response = await fetch(`http://127.0.0.1:1490/test/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  assert.equal(response.ok, true);
}
async function swipe(from, to, y) {
  await adb('shell', 'input', 'swipe', String(from), String(y), String(to), String(y), '350');
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
  await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'connected');
  const size = (await adb('shell', 'wm', 'size')).match(/(\d+)x(\d+)/);
  const width = Number(size[1]);
  const y = Math.round(Number(size[2]) * 0.4);
  const edge = Math.round(width * 0.08);
  const right = Math.round(width * 0.75);
  await action('legacy-history', { enabled: true });
  await action('sidebar', { action: 'history-pages' });
  console.log('Checking edge swipe and history loading from an old PC');
  await swipe(edge, right, y);
  await waitText('搜索聊天');
  await screenshot('drawer-edge-open');
  await tap('移动端聊天体验');
  await waitText('历史消息 35');
  assert.equal(await hasText('当前手机端暂不支持此操作'), false);
  assert.ok((await serverState()).operations.some((entry) => entry.operation === 'read'));
  await screenshot('drawer-legacy-history-loaded');
  await adb('shell', 'input', 'swipe', String(edge), String(y), String(edge), String(y + 300), '350');
  assert.equal(await hasText('搜索聊天'), false, 'vertical scroll does not open the drawer');
  await swipe(Math.round(width * 0.4), right, y);
  assert.equal(await hasText('搜索聊天'), false, 'swiping away from the edge does not open the drawer');
  await swipe(edge, right, y);
  await waitText('搜索聊天');
  await swipe(right, edge, y);
  await waitFor(async () => !(await hasText('搜索聊天')), 'left swipe closes drawer');
  await tap('打开聊天列表');
  await waitText('搜索聊天');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(async () => !(await hasText('搜索聊天')), 'Back closes only drawer');
  await waitText('移动端聊天体验');
  await tap('打开聊天列表');
  await waitText('搜索聊天');
  await adb('shell', 'input', 'tap', String(width - 20), String(y));
  await waitFor(async () => !(await hasText('搜索聊天')), 'backdrop closes drawer');
  await screenshot('drawer-closed-history-preserved');
  report.passed = true;
  console.log('PASS: legacy history, edge swipe, vertical/center scroll exclusion, left swipe, Back, backdrop');
} catch (error) {
  report.error = String(error);
  await screenshot('drawer-regression-failed');
  throw error;
} finally {
  await writeFile(path.join(output, 'drawer-report.json'), JSON.stringify(report, null, 2));
}
