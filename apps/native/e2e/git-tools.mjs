import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

process.env.ANDROID_CHAT_OUTPUT ??= 'git-tools-android';
const driver = await import('../../desktop/e2e/android-chat-driver.mjs');
const { adb, nodes, output, screenshot, tap, waitText, waitFor } = driver;
const packageName = 'com.codexswitch.mobile.gittest';
const apk = fileURLToPath(new URL('../android/app/build/outputs/apk/release/git-fixture.apk', import.meta.url));

try {
  await mkdir(output, { recursive: true });
  await prepareHierarchy(driver);
  await adb('install', '-r', apk);
  await adb('shell', 'am', 'force-stop', packageName);
  await adb('shell', 'am', 'start', '-n', `${packageName}/com.codexswitch.mobile.MainActivity`);
  await waitText('打开工具');
  await tap('打开工具');
  await waitText('终端');
  await screenshot('tools-menu');
  await tap('Git');
  await waitText('选择 src/app.ts');
  await tap('选择 src/app.ts');
  await tap('提交说明');
  await waitFor(async () => /mInputShown=true/.test(await adb('shell', 'dumpsys', 'input_method')), 'keyboard visible');
  await adb('shell', 'input', 'text', 'Update%scode');
  await waitFor(async () => {
    const windows = await adb('shell', 'dumpsys', 'window');
    const keyboard = /type=ime frame=\[\d+,(\d+)\]\[\d+,\d+\][^\r\n]*visible=true/.exec(windows);
    const current = await nodes();
    const input = current.find(node => node['content-desc'] === '提交说明');
    const submit = current.find(node => node.text === '提交 1 个文件');
    return !!keyboard && !!input && !!submit && input.rect[3] <= Number(keyboard[1])
      && submit.rect[3] <= Number(keyboard[1]);
  }, 'commit input and button above keyboard');
  await screenshot('git-keyboard');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await waitFor(async () => !/mInputShown=true/.test(await adb('shell', 'dumpsys', 'input_method')), 'keyboard hidden');
  await waitText('提交 1 个文件');
  await screenshot('git-changes');
  await tap('查看 src/app.ts');
  await waitText('返回上一层');
  await screenshot('git-diff');
  await tap('返回上一层');
  await tap('提交 1 个文件');
  await waitText('已提交 8f17d63a');
  assert.ok(!(await nodes()).some(node => node['content-desc'] === '选择 src/app.ts'));
  await tap('提交记录');
  await tap('加载更多提交');
  await waitText('首次提交');
  await screenshot('git-history');
  await tap('关闭Git');
  await waitText('打开工具');
  console.log('PASS native tool menu, file selection, diff, commit, merge history and keyboard layout');
} catch (error) {
  await screenshot('failure');
  throw error;
} finally {
  await adb('shell', 'am', 'force-stop', packageName);
}
