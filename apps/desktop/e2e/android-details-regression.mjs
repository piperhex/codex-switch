import assert from 'node:assert/strict';
import { adb, apiUrl, prepare, waitText, tap, input, screenshot, hasText, waitFor, serverState }
  from './android-chat-driver.mjs';

await prepare();
await fetch(`${apiUrl}/test/sidebar`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'message-details' }) });
await waitText('云端服务器地址');
await input(0, apiUrl);
await input(1, 'mobile-test@example.test');
await input(2, 'local-test');
if (/mInputShown=true/.test(await adb('shell', 'dumpsys', 'input_method'))) {
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
}
await tap('登录并查看');
await waitText('聊天消息');
await tap('打开聊天列表');
await waitText('移动端聊天体验');
await tap('移动端聊天体验');
await waitText('查看最近一轮文件修改');
await screenshot('details-01-chat');
await tap('查看最近一轮文件修改');
await waitText('复制 diff');
assert.equal(await hasText('const value = 2;', true), true);
await screenshot('details-02-diff');
await tap('复制 diff');
await waitText('已复制');
await tap('查看文件');
await waitText('完整文本');
await waitFor(async () => (await serverState()).operations.some((entry) => entry.operation === 'textPreview'),
  'file preview request');
await screenshot('details-03-file');
await tap('关闭文件内容');
await waitText('关闭文件修改');
await tap('关闭文件修改');
await waitText('查看执行命令详情');
await tap('查看执行命令详情', { scroll: true });
await waitText('OUTPUT_START', true);
await screenshot('details-04-output');
await tap('关闭执行命令');
await waitText('查看全文');
await tap('查看全文', { last: true, scroll: true });
await waitText('关闭回复内容');
await screenshot('details-05-full-text');
await tap('关闭回复内容');
const logs = await adb('logcat', '-d', '-s', 'ReactNativeJS:E', 'AndroidRuntime:E');
assert.doesNotMatch(logs, /FATAL EXCEPTION|TypeError|ReferenceError/);
console.log('PASS native chat text, diff, copy and scoped file preview');
