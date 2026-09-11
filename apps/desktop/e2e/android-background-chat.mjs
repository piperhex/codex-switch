import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, screenshot, hasText }
  from './android-chat-driver.mjs';

const report = { startedAt: new Date().toISOString(), cases: [] };
const fixture = 'http://127.0.0.1:1490';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function action(name) {
  const response = await fetch(fixture + '/test/sidebar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name }),
  });
  assert.equal(response.ok, true);
}
async function connectionUnchanged(count) {
  const state = await serverState();
  assert.equal(state.connectedMobiles, 1);
  assert.equal(state.mobileConnections, count);
}
async function notifications() {
  const dump = await adb('shell', 'dumpsys', 'notification', '--noredact');
  return dump.split(/(?=NotificationRecord\()/).filter((entry) => {
    const header = entry.split('\n')[0];
    return header.includes('pkg=com.codexswitch.mobile') && header.includes('tag=chat-');
  });
}
async function notificationCount() { return (await notifications()).length; }
async function check(name, test) {
  console.log('RUN ' + name);
  const started = Date.now();
  try {
    await test(); await screenshot(name);
    report.cases.push({ name, passed: true, durationMs: Date.now() - started });
    console.log('PASS ' + name);
  } catch (error) {
    report.cases.push({ name, passed: false, error: String(error) });
    await screenshot(name + '-failed'); throw error;
  }
}
async function openCompletion() {
  await adb('shell', 'cmd', 'statusbar', 'expand-notifications');
  await waitText('Codex 回复完成');
  await screenshot('background-notification');
  await tap('Codex 回复完成');
  await waitText('聊天消息');
  await waitText('移动端聊天体验');
  await waitFor(async () => (await serverState()).sidebar.readState['demo-chat']?.unread === false,
    'notification opens and reads its own conversation');
}

try {
  report.device = await prepare();
  await check('background-01-connect-on-app-open', async () => {
    await waitText('云端服务器地址');
    await input(0, fixture); await input(1, 'mobile-test@example.test'); await input(2, 'local-test');
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await tap('登录并查看'); await waitText('账户管理');
    await waitFor(async () => (await serverState()).connectedMobiles === 1, 'connect before opening chat tab');
    await waitFor(async () => (await adb('shell', 'dumpsys', 'activity', 'services', 'com.codexswitch.mobile'))
      .includes('isForeground=true'), 'foreground chat service');
  });
  await check('background-02-reuse-across-tabs', async () => {
    const connections = (await serverState()).mobileConnections;
    await tap('聊天', { last: true }); await waitText('新聊天');
    await tap('设备', { last: true }); await pause(1500);
    await connectionUnchanged(connections);
    await tap('账号', { last: true }); await pause(1500);
    await connectionUnchanged(connections);
    await action('start'); await action('complete');
    await waitFor(async () => (await notificationCount()) === 1, 'completion notification on another tab');
    assert.equal((await serverState()).sidebar.readState['demo-chat'].unread, true);
    await openCompletion();
    await connectionUnchanged(connections);
  });
  await check('background-03-complete-and-open-from-home', async () => {
    const connections = (await serverState()).mobileConnections;
    await tap('打开聊天列表'); await tap('新聊天');
    await action('start');
    await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await pause(5000); await connectionUnchanged(connections);
    await action('complete');
    await waitFor(async () => (await notificationCount()) === 1, 'background completion');
    assert.equal((await serverState()).sidebar.readState['demo-chat'].unread, true);
    await openCompletion();
    await connectionUnchanged(connections);
  });
  await check('background-04-reconnect-in-background', async () => {
    const connections = (await serverState()).mobileConnections;
    await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    assert.equal((await fetch(fixture + '/test/disconnect', { method: 'POST' })).ok, true);
    await waitFor(async () => {
      const state = await serverState();
      return state.connectedMobiles === 1 && state.mobileConnections > connections;
    }, 'background reconnect', 45_000);
    // Wait for the replacement encrypted channel to finish its handshake.
    await pause(12_000);
    await action('start'); await action('complete');
    await waitFor(async () => (await notificationCount()) === 1, 'notification after background reconnect');
    await openCompletion();
  });
  await check('background-05-logout-stops-service', async () => {
    await tap('设置', { last: true }); await tap('退出登录', { scroll: true });
    await waitText('确定要退出当前账号吗？'); await tap('退出登录', { last: true });
    await waitText('登录并查看');
    await waitFor(async () => (await serverState()).connectedMobiles === 0, 'logout disconnect');
    await waitFor(async () => !(await adb('shell', 'dumpsys', 'activity', 'services', 'com.codexswitch.mobile'))
      .includes('ChatConnectionService'), 'logout stops background service');
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = String(error); console.error(error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.fixture = await serverState().catch(() => null);
  await writeFile(path.join(output, 'background-report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'background-logcat.txt'), await adb('logcat', '-d'));
}
