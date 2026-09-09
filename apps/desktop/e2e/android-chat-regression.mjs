import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { markdownReport } from './android-chat-report.mjs';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, send, screenshot, hasText }
  from './android-chat-driver.mjs';

const report = {
  startedAt: new Date().toISOString(), scope: 'Native Android APK with local PC/admin fixtures', cases: [],
};
const operationCount = async (operation) =>
  (await serverState()).operations.filter((entry) => entry.operation === operation).length;
const ready = () => waitFor(async () => (await hasText('通过服务器连接')) || (await hasText('已直连')), 'chat connected');
const latestTurn = async () => (await serverState()).threads.flatMap((thread) => thread.turns ?? []).at(-1);
const settled = () => waitFor(async () => (await latestTurn())?.status !== 'inProgress', 'turn settled');

async function check(name, action) {
  const started = Date.now();
  console.log(`RUN ${name}`);
  try {
    await action();
    await screenshot(name);
    report.cases.push({ name, passed: true, durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({ name, passed: false, error: String(error), durationMs: Date.now() - started });
    await screenshot(`${name}-failed`);
    throw error;
  }
}

try {
  report.device = await prepare();
  await check('01-login-and-chat-tab', async () => {
    await waitText('云端服务器地址');
    await input(0, 'http://127.0.0.1:1490');
    await input(1, 'mobile-test@example.test');
    await input(2, 'local-test');
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await tap('登录并查看');
    await waitText('账户管理');
    await tap('聊天', { last: true });
    await waitText('选择电脑');
  });
  await check('02-connect-and-history', async () => {
    await tap('我的工作电脑');
    await ready();
    await tap('移动端聊天体验');
    await waitText('帮我整理今天的工作计划');
    assert.equal((await serverState()).connectedMobiles, 1);
  });
  await check('03-send-stream-and-keyboard', async () => {
    await send('Android regression message', { dismissKeyboard: false });
    await settled();
    await waitText('const connected = true;');
    assert.equal(await operationCount('send'), 1);
    await waitText('发送消息');
  });
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await check('04-steer-and-stop', async () => {
    await send('slow task');
    await waitText('停止回复');
    await send('additional detail', { steer: true });
    await waitFor(async () => (await operationCount('steer')) === 1, 'steered');
    await tap('停止回复');
    await waitFor(async () => (await latestTurn())?.status === 'interrupted', 'interrupted');
    await waitText('发送消息');
    assert.equal(await operationCount('interrupt'), 1);
  });
  await check('05-approve-on-phone', async () => {
    await send('approval accept');
    await waitText('需要你的确认');
    await screenshot('05-approval-prompt');
    await tap('允许这一次', { scroll: true });
    await settled();
    const state = await serverState();
    assert.equal(state.approvals.length, 0);
    assert.equal(state.operations.filter((entry) => entry.decision === 'accept').length, 1);
  });
  await check('06-decline-on-phone', async () => {
    await send('approval decline');
    await waitText('需要你的确认');
    await tap('拒绝', { scroll: true });
    await settled();
    assert.equal((await serverState()).operations.filter((entry) => entry.decision === 'decline').length, 1);
  });
  await check('07-answer-question', async () => {
    await send('question test');
    await waitText('请选择下一步');
    await tap('继续验证', { scroll: true });
    await tap('提交回答', { scroll: true });
    await settled();
    const response = (await serverState()).operations.find((entry) => entry.answers);
    assert.deepEqual(response.answers.choice.answers, ['继续验证']);
  });
  await check('08-create-new-thread', async () => {
    await tap('返回');
    await tap('＋ 新聊天');
    await send('new chat from Android');
    await settled();
    await waitText('手机新聊天');
    const state = await serverState();
    assert.equal(state.threads.length, 2);
    assert.equal(state.operations.filter((entry) => entry.operation === 'start').length, 1);
    assert.equal(state.operations.filter((entry) => entry.operation === 'send').at(-1).threadId, state.threads[1].id);
  });
  await check('09-archive-and-restore', async () => {
    await tap('归档');
    await waitFor(async () => (await serverState()).archived.length === 1, 'archived');
    await tap('最近聊天 ▾');
    await tap('手机新聊天');
    await tap('恢复');
    await waitFor(async () => (await serverState()).archived.length === 0, 'restored');
    await tap('已归档 ▾');
    await tap('移动端聊天体验');
  });
  await check('10-disconnect-and-resynchronize', async () => {
    const sent = await operationCount('send');
    const reads = await operationCount('read');
    const connections = (await serverState()).mobileConnections;
    const response = await fetch('http://127.0.0.1:1490/test/disconnect', { method: 'POST' });
    assert.equal(response.ok, true);
    await waitFor(async () => (await serverState()).mobileConnections > connections, 'new connection established');
    await ready();
    await waitFor(async () => (await operationCount('read')) > reads, 'history resynchronized');
    assert.equal(await operationCount('send'), sent);
    await waitText('移动端聊天体验');
  });
  await check('11-tab-and-background-reconnect', async () => {
    await tap('账号', { last: true });
    await waitFor(async () => (await serverState()).connectedMobiles === 0, 'tab cleanup');
    await tap('聊天', { last: true });
    await ready();
    await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await waitFor(async () => (await serverState()).connectedMobiles === 0, 'background cleanup');
    await adb('shell', 'am', 'start', '-n', 'com.codexswitch.mobile/.MainActivity');
    await ready();
  });
  report.fixture = await serverState();
  assert.deepEqual(report.fixture.streamErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  const logs = await adb('logcat', '-d', '-s', 'ReactNativeJS:E', 'AndroidRuntime:E');
  await writeFile(path.join(output, 'logcat.txt'), logs);
  if (/ReactNativeJS:|FATAL EXCEPTION/.test(logs)) {
    report.passed = false;
    report.error = 'Android runtime error detected; inspect logcat.txt';
    process.exitCode = 1;
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'report.md'), markdownReport(report, output));
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases, output, error: report.error }, null, 2));
}
