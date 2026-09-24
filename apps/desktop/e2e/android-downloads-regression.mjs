import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, screenshot, hasText }
  from './android-chat-driver.mjs';

const reads = async () => (await serverState()).operations.filter(item => item.operation === 'fileRead');
const report = [];
const fixture = action => fetch('http://127.0.0.1:1490/test/sidebar', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
async function check(name, action) {
  await action(); await screenshot(name); report.push(name); console.log(`PASS ${name}`);
}

try {
  await prepare();
  await waitText('云端服务器地址');
  await input(0, 'http://127.0.0.1:1490');
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitFor(async () => (await hasText('聊天消息')) || (await hasText('同意并登录')), 'local fixture login');
  if (await hasText('同意并登录')) await tap('同意并登录');
  await waitText('聊天消息');
  await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'connected');
  await fetch('http://127.0.0.1:1490/test/sidebar', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'downloads' }) });
  await tap('打开聊天列表'); await tap('移动端聊天体验');
  await waitText('下载安装包');

  await check('01-close-preview-keeps-downloading', async () => {
    await tap('下载安装包'); await tap('下载');
    await waitFor(async () => (await reads()).length > 1, 'download started');
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    const before = (await reads()).length;
    await tap('设置', { last: true }); await tap('下载管理');
    await waitText('regression.apk');
    await waitFor(async () => (await reads()).length > before + 1, 'download continued after drawer closed');
  });
  let resumeIndex;
  await check('02-pause-resume-from-offset', async () => {
    await tap('暂停'); await waitText('已暂停');
    resumeIndex = (await reads()).length;
    // UI remains usable while the saved task is paused.
    await tap('当前项目'); await waitText('下载：small.zip'); await tap('下载列表');
    assert.equal((await reads()).length, resumeIndex);
    await adb('shell', 'am', 'force-stop', 'com.codexswitch.mobile');
    await adb('shell', 'am', 'start', '-n', 'com.codexswitch.mobile/.MainActivity');
    await waitText('聊天消息');
    await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'reconnected after restart');
    await tap('打开聊天列表'); await tap('移动端聊天体验'); await waitText('下载安装包');
    await tap('设置', { last: true }); await tap('下载管理'); await waitText('已暂停');
    await tap('继续下载');
    await waitFor(async () => (await reads()).length > resumeIndex, 'resumed');
    assert.ok((await reads())[resumeIndex].offset > 0, 'must resume with a nonzero range');
  });
  await check('03-home-keeps-native-download-active', async () => {
    const before = (await reads()).length;
    await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await waitFor(async () => (await reads()).length > before + 3, 'background transfer');
    await adb('shell', 'am', 'start', '-n', 'com.codexswitch.mobile/.MainActivity');
    await waitText('下载管理');
  });
  await check('04-complete-file-hash-and-delete', async () => {
    await waitFor(() => hasText('已完成'), 'download completed', 120_000);
    const local = path.join(output, 'regression.apk');
    await adb('pull', '/sdcard/Download/Codex Switch/regression.apk', local);
    const size = 32 * 1024 * 1024 + 17;
    const expected = Buffer.alloc(size);
    for (let i = 0; i < size; i++) expected[i] = i % 251;
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest(await readFile(local)), digest(expected));
    await tap('删除'); await waitText('将删除手机上的文件'); await tap('删除', { last: true });
    await waitText('暂无下载');
    assert.equal(await adb('shell', 'test -e "/sdcard/Download/Codex Switch/regression.apk"; echo $?'), '1');
  });
  await check('05-browse-drives-and-delete-active-transfer', async () => {
    await tap('此电脑'); await waitText('打开文件夹：C:/');
    await tap('打开文件夹：C:/'); await tap('下载：regression.apk'); await tap('下载列表');
    await waitText('正在下载'); await tap('删除'); await tap('删除', { last: true });
    await waitText('暂无下载');
    const before = (await reads()).length;
    await tap('此电脑'); await waitText('打开文件夹：F:/'); await tap('下载列表');
    assert.equal((await reads()).length, before, 'deleted download must not restart');
  });
  await check('06-zero-byte-project-file', async () => {
    await tap('当前项目'); await waitText('下载：empty'); await tap('下载：empty'); await tap('下载列表');
    await waitText('已完成');
    const local = path.join(output, 'empty');
    await adb('pull', '/sdcard/Download/Codex Switch/empty', local);
    assert.equal((await readFile(local)).length, 0);
    await tap('删除'); await tap('删除', { last: true }); await waitText('暂无下载');
  });
  await check('07-changed-source-restarts-safely', async () => {
    const before = (await reads()).length;
    await tap('当前项目'); await waitText('下载：regression.apk'); await tap('下载：regression.apk'); await tap('下载列表');
    await waitFor(async () => (await reads()).length > before + 1, 'new partial download');
    await tap('暂停'); await waitText('已暂停');
    await fixture('downloads-change');
    const paused = (await reads()).length;
    await tap('继续下载');
    await waitFor(async () => (await reads()).length > paused, 'changed source reopened');
    assert.equal((await reads())[paused].offset, 0, 'a different revision must restart');
    await waitText('文件已更新，已从头下载。');
    await tap('删除'); await tap('删除', { last: true }); await waitText('暂无下载');
  });
  await check('08-invalid-chunk-stays-incomplete-and-can-retry', async () => {
    await fixture('downloads-corrupt');
    await tap('当前项目'); await waitText('下载：small.zip'); await tap('下载：small.zip'); await tap('下载列表');
    await waitText('下载中断');
    await fixture('downloads-valid');
    await tap('继续下载'); await waitText('已完成');
    const local = path.join(output, 'small.zip');
    await adb('pull', '/sdcard/Download/Codex Switch/small.zip', local);
    assert.equal((await readFile(local)).length, 1024 * 1024 + 3);
    await tap('删除'); await tap('删除', { last: true }); await waitText('暂无下载');
  });
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
