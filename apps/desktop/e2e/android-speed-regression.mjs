import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, apiUrl, output, prepare, serverState, waitFor, waitText, tap, tapNode, input,
  screenshot, hasText, nodes } from './android-chat-driver.mjs';

const report = { passed: false, cases: [] };
const speedLabels = { normal: '普通模式', fast: '快速模式' };
const composer = async () => (await nodes()).find((node) => node['content-desc']?.endsWith('，聊天设置'));

async function fixture(route, data) {
  const response = await fetch(`${apiUrl}/test/${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(response.ok, true);
}

async function checkIndicator(speed) {
  await waitFor(async () => {
    const node = await composer();
    return node && node['content-desc'].includes('，快速模式') === (speed === 'fast');
  }, `${speed} composer indicator`);
}

async function phoneSelect(speed) {
  await tapNode(await composer());
  await tap('设置速度模式');
  await waitText('选择速度模式');
  await screenshot(`speed-options-${speed}`);
  await tap(speedLabels[speed]);
  await waitFor(async () => (await serverState()).composer.settings.speed === speed, `${speed} saved on PC`);
  await waitText('设置速度模式');
  await tap('关闭聊天设置');
  await checkIndicator(speed);
  await screenshot(`speed-composer-${speed}`);
  report.cases.push(`phone-${speed}`);
}

try {
  report.device = await prepare();
  await waitText('云端服务器地址');
  await input(0, apiUrl);
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitText('聊天消息');
  await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'connected');
  await tap('打开聊天列表');
  await tap('移动端聊天体验');
  await waitText('你可以直接从手机继续这个任务。');
  await checkIndicator('normal');
  await phoneSelect('fast');
  await phoneSelect('normal');

  await tapNode(await composer());
  await tap('设置速度模式');
  await fixture('composer', { speed: 'fast' });
  await waitFor(async () => (await nodes()).some((node) => node['content-desc'] === '快速模式'
    && node.checked === 'true'), 'PC change updates the open radio choice');
  await screenshot('speed-pc-updated-open-menu');
  await tap('返回上一层');
  await tap('关闭聊天设置');
  await checkIndicator('fast');
  await fixture('composer', { speed: 'normal' });
  await checkIndicator('normal');
  report.cases.push('pc-changes');

  await fixture('sidebar', { action: 'start' });
  await waitText('暂停生成');
  await phoneSelect('fast');
  await waitText('暂停生成');
  await phoneSelect('normal');
  await waitText('暂停生成');
  await tap('暂停生成');
  await waitFor(async () => !(await hasText('暂停生成')), 'reply pauses after speed changes');
  assert.deepEqual((await serverState()).streamErrors, []);
  report.cases.push('settings-remain-responsive-during-reply');
  report.passed = true;
  console.log(`PASS: ${report.cases.length} speed synchronization cases`);
} catch (error) {
  report.error = String(error);
  await screenshot('speed-failed');
  throw error;
} finally {
  await writeFile(path.join(output, 'speed-report.json'), JSON.stringify(report, null, 2));
}
