import assert from 'node:assert/strict';
import { hasText, nodes, screenshot, send, serverState, tap, waitFor, waitText } from './android-chat-driver.mjs';

async function choose(field, value) {
  await tap(`设置${field}`);
  await waitText(value);
  const option = (await nodes()).find((node) => node['content-desc'] === value);
  assert.equal(option?.enabled, 'true', `${field} remains editable during a save`);
  await tap(value);
  await waitText(`设置${field}`);
}

export async function existingChatSettings() {
  await tap('打开聊天列表');
  await waitText('移动端聊天体验');
  await tap('移动端聊天体验');
  await send('slow task while editing settings');
  await waitText('停止回复');
  const delayed = await fetch('http://127.0.0.1:1490/test/settings-delay', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ milliseconds: 5000 }) });
  assert.equal(delayed.ok, true);
  await tap('第二模型 · 极高，聊天设置');
  await choose('模型', '测试模型');
  await waitText('正在保存设置…');
  await choose('推理强度', '高');
  await choose('访问权限', '请求批准');
  await screenshot('15-existing-chat-settings-saving');
  await waitFor(async () => !(await hasText('正在保存设置…')), 'settings saved');
  const reset = await fetch('http://127.0.0.1:1490/test/settings-delay', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ milliseconds: 0 }) });
  assert.equal(reset.ok, true);
  await tap('关闭聊天设置');
  await waitText('测试模型 · 高');
  await tap('停止回复');
  await waitFor(async () => !(await hasText('停止回复')), 'turn interrupted');
  await send('next message after editing existing settings');
  await waitFor(async () => !(await hasText('停止回复')), 'next turn completed');
  const operation = (await serverState()).operations.findLast((entry) => entry.operation === 'send');
  assert.deepEqual({ threadId: operation.threadId, model: operation.model, effort: operation.effort,
    access: operation.access }, { threadId: 'demo-chat', model: 'test-model', effort: 'high', access: 'read-only' });
}
