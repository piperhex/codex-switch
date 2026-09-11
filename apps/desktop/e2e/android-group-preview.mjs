import assert from 'node:assert/strict';
import { hasText, screenshot, tap, waitText } from './android-chat-driver.mjs';

export async function groupPreviewJourney() {
  await tap('打开聊天列表');
  await tap('新聊天');
  const response = await fetch('http://127.0.0.1:1490/test/sidebar', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'group-preview' }) });
  assert.equal(response.ok, true);
  await tap('打开聊天列表');
  // Reload the seeded list so this check does not depend on notification/list response ordering.
  await tap('最近聊天 ▾');
  await waitText('暂时没有聊天');
  await tap('已归档 ▾');
  await waitText('演示项目');
  assert.equal(await hasText('项目聊天 5'), false);
  await tap('展开显示：演示项目', { scroll: true });
  await tap('项目聊天 5', { scroll: true });
  await waitText('聊天消息');
  await tap('打开聊天列表');
  await tap('展开显示：演示项目', { scroll: true });
  await tap('收起：演示项目', { scroll: true });
  await waitText('项目聊天 5');
  assert.equal(await hasText('项目聊天 4'), false);
  await screenshot('16-folded-selected-chat');
}
