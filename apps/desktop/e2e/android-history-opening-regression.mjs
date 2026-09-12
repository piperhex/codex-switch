import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, apiUrl, output, prepare, serverState, waitFor, waitText, tap, tapNode, input,
  screenshot, hasText, nodes } from './android-chat-driver.mjs';
import { openingRegions, recordHistoryOpening } from './android-history-opening-video.mjs';

const footerOnly = process.argv.includes('--footer-only');
const report = { startedAt: new Date().toISOString(), scope: footerOnly ? 'tall-footer' : 'conversation-opening',
  passed: false, cases: [] };
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const visible = (node) => node.rect[2] > node.rect[0] && node.rect[3] > node.rect[1];
const DIFF_LABEL = '查看最近一轮文件修改';
const PAUSE_REPLY = '暂停生成';

async function fixtureAction(route, data) {
  const response = await fetch(`${apiUrl}/test/${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(response.ok, true);
}

async function visibleText(text) {
  return (await nodes()).some((node) => visible(node) && node.text?.includes(text));
}

const waitVisible = (text) => waitFor(() => visibleText(text), `visible ${text}`);
const connected = () => waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'chat connected');

async function coldStart() {
  await adb('shell', 'am', 'force-stop', 'com.codexswitch.mobile');
  await adb('shell', 'am', 'start', '-n', 'com.codexswitch.mobile/.MainActivity');
  await waitText('聊天消息');
  await connected();
}

async function openConversation(name, marker) {
  await tap('打开聊天列表');
  await waitText('移动端聊天体验');
  const target = (await nodes()).find((node) => visible(node) && node.text === '移动端聊天体验');
  const result = await recordHistoryOpening({ name, open: async () => {
    await tapNode(target);
    await waitVisible(marker);
    await pause(500);
    await screenshot(name);
    return openingRegions(await nodes());
  } });
  report.cases.push(result);
}

async function allCachedHistory() {
  await fixtureAction('history-delay', { milliseconds: 0 });
  for (let attempt = 0; attempt < 10; attempt++) {
    await adb('shell', 'input', 'swipe', '540', '450', '540', '1700', '80');
    await pause(1000);
    if (await visibleText('打开记录 1\n')) break;
  }
  await waitVisible('打开记录 1\n');
  await screenshot('opening-all-history-loaded');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await openConversation('opening-all-cached', '记录末尾 35');
  await waitVisible(DIFF_LABEL);
}

async function runningConversation() {
  await fixtureAction('sidebar', { action: 'start' });
  await waitText(PAUSE_REPLY);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('打开聊天列表');
  await tap('移动端聊天体验');
  await waitVisible('处理中…');
  await waitVisible(DIFF_LABEL);
  const replyText = async () => (await nodes()).filter((node) => visible(node) && node.text?.includes('处理中…'))
    .map((node) => node.text).join('');
  const before = await replyText();
  await waitFor(async () => await replyText() !== before, 'visible reply continues after opening');
  await screenshot('opening-running-conversation');
  await tap(PAUSE_REPLY);
  await waitFor(async () => !(await hasText(PAUSE_REPLY)), 'reply pauses');
  assert.deepEqual((await serverState()).streamErrors, []);
  report.cases.push({ name: 'opening-running-conversation', contentAndFooterVisible: true });
}

async function emptyConversation() {
  await fixtureAction('sidebar', { action: 'history-empty' });
  await coldStart();
  await tap('打开聊天列表');
  await tap('移动端聊天体验');
  await waitVisible('想一起完成什么？');
  assert.equal(await hasText('正在加载聊天记录'), false, 'An empty conversation finishes loading');
  await screenshot('opening-empty-conversation');
  report.cases.push({ name: 'opening-empty-conversation', finishedLoading: true });
}

async function earlyReplyDuringHistory() {
  await fixtureAction('sidebar', { action: 'history-opening' });
  await fixtureAction('history-delay', { milliseconds: 5000 });
  await coldStart();
  const reads = (await serverState()).synchronization.length;
  await tap('打开聊天列表');
  await tap('移动端聊天体验');
  await waitFor(async () => (await serverState()).synchronization.length > reads, 'initial history request starts');
  await fixtureAction('sidebar', { action: 'start' });
  await waitText(PAUSE_REPLY);
  assert.equal(await hasText('正在加载聊天记录'), true, 'First history remains covered while a live reply arrives');
  assert.equal(await visibleText('处理中…'), false, 'A live event does not reveal incomplete initial history');
  await screenshot('opening-early-reply-loading');
  await waitVisible('处理中…');
  await waitVisible(DIFF_LABEL);
  await screenshot('opening-early-reply-ready');
  await tap(PAUSE_REPLY);
  await waitFor(async () => !(await hasText(PAUSE_REPLY)), 'reply pauses');
  report.cases.push({ name: 'opening-early-reply', waitedForInitialHistory: true });
}

async function tallFooter() {
  await fixtureAction('sidebar', { action: 'history-footer' });
  await fixtureAction('history-delay', { milliseconds: 0 });
  await coldStart();
  await openConversation('opening-tall-footer', '错误详情结束');
  assert.equal(await hasText('正在加载聊天记录'), false, 'A tall footer does not leave loading stuck');
}

async function openingCases() {
  await openConversation('opening-short-conversation', '你可以直接从手机继续这个任务。');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await fixtureAction('sidebar', { action: 'history-pages' });
  await coldStart();
  await openConversation('opening-cold-fast', '历史消息 35');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await openConversation('opening-cached-fast', '历史消息 35');
  await fixtureAction('history-delay', { milliseconds: 1000 });
  await coldStart();
  await openConversation('opening-cold-slow', '历史消息 35');
  await fixtureAction('sidebar', { action: 'history-opening' });
  await coldStart();
  await openConversation('opening-long-reply', '记录末尾 35');
  await waitVisible(DIFF_LABEL);
  await allCachedHistory();
  await runningConversation();
  await emptyConversation();
  await earlyReplyDuringHistory();
  await tallFooter();
}

try {
  report.device = await prepare();
  assert.match(await adb('shell', 'wm', 'size'), /1080x2424/, 'Video checks use the disposable Pixel 9 emulator');
  await waitText('云端服务器地址');
  await input(0, apiUrl);
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitText('聊天消息');
  await connected();
  if (footerOnly) await tallFooter();
  else await openingCases();
  report.passed = true;
  console.log(`PASS: ${report.cases.length} conversation-opening cases`);
} catch (error) {
  report.error = String(error);
  await screenshot('history-opening-failed');
  throw error;
} finally {
  await writeFile(path.join(output, 'history-opening-report.json'), JSON.stringify(report, null, 2));
}
