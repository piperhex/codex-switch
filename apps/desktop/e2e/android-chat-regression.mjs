import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { markdownReport } from './android-chat-report.mjs';
import { existingChatSettings } from './android-existing-settings.mjs';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, send, screenshot, hasText }
  from './android-chat-driver.mjs';

const report = {
  startedAt: new Date().toISOString(), scope: 'Native Android APK with local PC/admin fixtures', cases: [],
};
const operationCount = async (operation) =>
  (await serverState()).operations.filter((entry) => entry.operation === operation).length;
const ready = () => waitFor(async () => (await hasText('通过服务器连接')) || (await hasText('已直连')), 'chat connected');
const latestTurn = async () => {
  const state = await serverState();
  const operation = state.operations.findLast((entry) => ['send', 'steer'].includes(entry.operation));
  return state.threads.find((thread) => thread.id === operation?.threadId)?.turns?.at(-1);
};
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
    await waitText('聊天消息');
    assert.equal(await hasText('搜索聊天'), false);
    await screenshot('01-new-chat');
  });
  await check('02-connect-and-history', async () => {
    await ready();
    await tap('打开聊天列表');
    await waitText('演示项目');
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
    const changed = await fetch('http://127.0.0.1:1490/test/composer', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effort: 'high' }) });
    assert.equal(changed.ok, true);
    await waitText('测试模型 · 高');
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
    await tap('打开聊天列表');
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
  await check('12-inline-images-and-preview', async () => {
    for (const [prompt, label] of [['local image preview', '本地图片'], ['remote image preview', '网络图片']]) {
      await send(prompt);
      await settled();
      await waitText(`放大查看：${label}`);
      assert.equal(await hasText('图片加载失败'), false);
      await screenshot(`12-${label === '本地图片' ? 'local' : 'remote'}-image`);
      await tap(`放大查看：${label}`);
      await waitText('关闭图片');
      await screenshot(`12-${label === '本地图片' ? 'local' : 'remote'}-preview`);
      await tap('关闭图片');
    }
    assert.ok(await operationCount('imagePreview') > 0);
    await send('message after images');
    await settled();
  });
  await check('13-model-effort-and-access-sync', async () => {
    const response = await fetch('http://127.0.0.1:1490/test/composer', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: 'second-model', effort: 'xhigh', access: 'danger-full-access',
      }) });
    assert.equal(response.ok, true);
    await waitText('第二模型 · 极高');
    await screenshot('13-pc-model-synced');
    await tap('第二模型 · 极高，聊天设置');
    await waitText('设置访问权限');
    assert.equal(await hasText('请求批准'), false);
    await screenshot('13-settings-menu');
    await tap('设置模型');
    await waitText('选择模型');
    await screenshot('13-model-drawer');
    await tap('返回上一层');
    await waitText('设置模型');
    await tap('设置推理强度');
    await waitText('关闭推理强度');
    await screenshot('13-effort-drawer');
    await tap('极高');
    await waitText('设置推理强度');
    for (const [label, access] of [['请求批准', 'read-only'], ['帮我批准', 'workspace-write'],
      ['完全访问', 'danger-full-access']]) {
      await tap('设置访问权限');
      await waitText('请求批准');
      await screenshot('13-access-options');
      await tap(label, { scroll: true });
      await waitFor(async () => (await serverState()).composer.settings.access === access, `${label} synced`);
      await waitText('设置访问权限');
    }
    await tap('关闭聊天设置');
    await send('send with synced settings');
    await settled();
    assert.deepEqual((await serverState()).operations.filter((entry) => entry.operation === 'send').at(-1), {
      operation: 'send', threadId: 'demo-chat', text: 'send with synced settings', model: 'second-model',
      effort: 'xhigh', access: 'danger-full-access', images: [], method: 'request',
    });
  });
  await check('14-project-drawer-and-read-sync', async () => {
    const change = async (action) => {
      const response = await fetch('http://127.0.0.1:1490/test/sidebar', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      assert.equal(response.ok, true);
    };
    await tap('打开聊天列表');
    await waitText('演示项目');
    await waitText('最近');
    await change('start');
    await waitText('正在回复');
    await screenshot('14-project-drawer-running');
    await change('complete');
    await waitText('未读回复');
    assert.equal(await hasText('正在回复'), false);
    await screenshot('14-project-drawer-unread');
    await change('read');
    await waitFor(async () => !(await hasText('未读回复')), 'PC read receipt synced');
    await change('start');
    await change('complete');
    await waitText('未读回复');
    await tap('移动端聊天体验');
    await waitFor(async () => !(await serverState()).sidebar.readState['demo-chat'].unread,
      'phone read receipt synced');
    assert.equal(await hasText('搜索聊天'), false);
    await tap('打开聊天列表');
    assert.equal(await hasText('未读回复'), false);
    await tap('＋ 新聊天');
    await waitText('想一起完成什么？');
    await waitText('聊天消息');
  });
  await check('15-existing-chat-settings-stay-editable', existingChatSettings);
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
