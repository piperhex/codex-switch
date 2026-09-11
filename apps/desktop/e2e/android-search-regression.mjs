import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, screenshot, hasText, nodes, send }
  from './android-chat-driver.mjs';

async function login() {
  await waitText('云端服务器地址');
  await input(0, 'http://127.0.0.1:1490');
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitText('聊天消息');
  await waitFor(async () => (await hasText('已直连')) || (await hasText('通过服务器连接')), 'connected');
}

async function profileJourney() {
  await tap('打开聊天列表');
  const sidebar = await nodes();
  assert.equal(sidebar.some((node) =>
    node.class === 'android.widget.EditText' && node['content-desc'] === '搜索聊天'), false);
  assert.equal(await hasText('切换电脑'), false);
  assert.equal(await hasText('切换账户'), false);
  const create = sidebar.find((node) => node['content-desc'] === '新聊天');
  const avatar = sidebar.find((node) => node['content-desc'] === '打开头像菜单');
  assert.ok(create.rect[0] < avatar.rect[0] && Math.abs(create.rect[1] - avatar.rect[1]) < 10);
  await screenshot('search-sidebar-footer');
  await tap('打开头像菜单');
  await waitText('切换电脑');
  await screenshot('search-profile-menu');
  await tap('切换账户');
  await waitText('演示账户二');
  await tap('演示账户二');
  await waitText('账户与电脑');
  assert.ok((await serverState()).operations.some((entry) =>
    entry.operation === 'guiAccountSelect' && entry.selection.id === 'second'));
  await tap('切换电脑');
  await waitText('选择电脑');
  await tap('我的工作电脑');
  await waitText('聊天消息');
}

async function searchJourney() {
  await tap('打开聊天列表');
  await tap('搜索聊天');
  await waitText('关闭搜索');
  assert.equal(await hasText('打开头像菜单'), false);
  await input('搜索聊天', 'no-match');
  await waitText('没有找到相关聊天');
  await screenshot('search-empty-keyboard');
  const controls = await nodes();
  const field = controls.find((node) => node.class === 'android.widget.EditText');
  const close = controls.find((node) => node['content-desc'] === '关闭搜索');
  assert.ok(Math.abs(field.rect[1] - close.rect[1]) < 20, 'input and close button share the bottom toolbar');
  assert.match(await adb('shell', 'dumpsys', 'input_method'), /mInputShown=true/, 'search focuses the keyboard');
  await tap('清空搜索');
  await waitText('输入关键词，查找聊天');
  await input('搜索聊天', '1');
  await waitText('项目聊天 1');
  await screenshot('search-matching-chat');
  await tap('关闭搜索');
  await waitText('移动端聊天体验');
  assert.equal((await nodes()).some((node) =>
    node.class === 'android.widget.EditText' && node['content-desc'] === '搜索聊天'), false);
  await tap('搜索聊天');
  await input('搜索聊天', '1');
  await waitText('项目聊天 1');
  await tap('项目聊天 1');
  await waitText('聊天消息');
  assert.equal(await hasText('关闭搜索'), false);
  await screenshot('search-opened-chat');
}

const report = { startedAt: new Date().toISOString(), passed: false };
try {
  report.device = await prepare();
  console.log('Checking login and active reply');
  await login();
  await tap('打开聊天列表');
  await tap('移动端聊天体验');
  await send('slow task');
  console.log('Checking sidebar footer and profile menu');
  await profileJourney();
  const response = await fetch('http://127.0.0.1:1490/test/sidebar', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'group-preview' }) });
  assert.equal(response.ok, true);
  console.log('Checking search input, keyboard and navigation');
  await searchJourney();
  await tap('打开聊天列表');
  await tap('新聊天');
  await waitText('聊天消息');
  assert.equal(await hasText('打开头像菜单'), false);
  report.passed = true;
  console.log('PASS: sidebar footer, profile switching, live search, keyboard, clear, close and result navigation');
} catch (error) {
  report.error = String(error);
  await screenshot('search-regression-failed');
  throw error;
} finally {
  await writeFile(path.join(output, 'search-report.json'), JSON.stringify(report, null, 2));
}
