import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, activity, apiUrl, appErrorLogs, output, prepare, serverState, waitFor,
  waitText, tap, input, send, screenshot, hasText } from './android-chat-driver.mjs';

const report = { passed: false, cases: [], startedAt: new Date().toISOString() };
const ready = () => waitFor(async () => (await hasText('Relay')) || (await hasText('P2P')), 'chat connected');
const count = async operation => (await serverState()).operations.filter(item => item.operation === operation).length;
async function check(name, action) {
  console.log('RUN', name);
  await action();
  await screenshot(name);
  report.cases.push(name);
  console.log('PASS', name);
}
try {
  report.device = await prepare();
  await check('login-and-connect', async () => {
    await waitText('云端服务器地址');
    await input(0, apiUrl);
    await input(1, 'mobile-test@example.test');
    await input(2, 'local-test');
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await tap('登录并查看');
    await waitText('同意并登录');
    await tap('同意并登录');
    await waitFor(async () => {
      // MIUI can show its own notification prompt even after the Android permission was granted.
      if (await hasText('始终允许')) await tap('始终允许');
      if (await hasText('允许通知')) await tap('允许通知');
      return hasText('聊天消息');
    }, 'chat screen');
    await ready();
  });
  await check('history-and-message', async () => {
    await tap('打开聊天列表');
    await waitText('移动端聊天体验');
    await tap('移动端聊天体验');
    await waitText('帮我整理今天的工作计划');
    await send('Android connection regression');
    await waitText('const connected = true;');
    assert.equal(await count('send'), 1);
  });
  await check('relay-fallback', async () => {
    const response = await fetch(`${apiUrl}/test/fallback`, { method: 'POST' });
    assert.ok(response.ok);
    await waitText('Relay');
    const before = (await serverState()).relayFrames;
    await send('Android relay regression');
    await waitFor(async () => (await serverState()).relayFrames > before, 'encrypted relay traffic');
  });
  await check('disconnect-and-resynchronize', async () => {
    const before = await serverState();
    const sends = await count('send');
    const reads = await count('syncHistory');
    assert.ok((await fetch(`${apiUrl}/test/disconnect`, { method: 'POST' })).ok);
    await waitFor(async () => (await serverState()).mobileConnections > before.mobileConnections, 'reconnection');
    await ready();
    await waitFor(async () => await count('syncHistory') > reads, 'history resynchronized');
    assert.equal(await count('send'), sends, 'reconnect must not execute the same send twice');
  });
  await check('background-and-return', async () => {
    await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.equal((await serverState()).connectedMobiles, 1);
    await adb('shell', 'am', 'start', '-n', activity);
    await ready();
    await send('Android foreground regression');
    assert.equal(await count('send'), 3);
  });
  const logs = await appErrorLogs();
  await writeFile(path.join(output, 'logcat.txt'), logs);
  assert.ok(!/ReactNativeJS:|FATAL EXCEPTION/.test(logs), 'no Android runtime errors');
  assert.deepEqual((await serverState()).streamErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  await screenshot('failed');
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'connectivity-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
