import type { RpcRequest } from '../../../shared/remote-chat/protocol';
import type { ChatLink } from '../../../shared/remote-chat/link';
import type { Thread, Turn } from '../src/pages/codexGui/types';

const thread: Thread = { id: 'demo-chat', name: '移动端聊天体验', preview: '继续电脑上的任务', cwd: 'F:/projects/demo',
  updatedAt: Math.floor(Date.now() / 1000), turns: [{ id: 'welcome', status: 'completed', items: [
    { id: 'question', type: 'userMessage', content: [{ type: 'text', text: '帮我整理今天的工作计划。' }] },
    { id: 'answer', type: 'agentMessage', text: '可以，今天先完成这三件事：\n\n1. 检查项目进度\n2. 处理需要确认的事项\n3. 验证手机与电脑之间的同步\n\n你可以直接从手机继续这个任务。' },
  ] }] };

export function demoResponse(request: RpcRequest, link: ChatLink): unknown {
  if (request.method === 'connect') return [];
  const input = request.body as { operation?: string; text?: string };
  if (input.operation === 'models') return { data: [{ id: 'demo', model: 'test-model', displayName: '测试模型',
    isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: '标准' }, { reasoningEffort: 'high', description: '深入' },
    ] }], nextCursor: null };
  if (input.operation === 'list') return { data: [thread], nextCursor: null };
  if (input.operation === 'read' || input.operation === 'resume' || input.operation === 'start') return { thread };
  if (input.operation === 'send') {
    void streamDemo(link, input.text ?? '');
    return { turn: { id: 'reply', status: 'inProgress', items: [] } };
  }
  return {};
}

async function streamDemo(link: ChatLink, text: string) {
  const turn: Turn = { id: `turn-${Date.now()}`, status: 'inProgress', items: [
    { id: `user-${Date.now()}`, type: 'userMessage', content: [{ type: 'text', text }] },
  ] };
  thread.turns?.push(turn);
  await link.send({ kind: 'event', event: { method: 'turn/started', params: { threadId: thread.id, turn } } });
  const item = { id: `response-${Date.now()}`, type: 'agentMessage', text: '' };
  await link.send({ kind: 'event', event: { method: 'item/started',
    params: { threadId: thread.id, turnId: turn.id, item } } });
  const parts = ['已经收到你的消息。', '\n\n手机和电脑正在同步，', '你可以继续查看任务，', '也可以在处理过程中补充要求。',
    '\n\n```typescript\n', 'const connected = true;\n', '```\n', '\n这条回复用于验证实际移动端的收发和显示。'];
  for (const delta of parts) {
    item.text += delta;
    await link.send({ kind: 'event', event: { method: 'item/agentMessage/delta',
      params: { threadId: thread.id, turnId: turn.id, itemId: item.id, delta } } });
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  turn.status = 'completed';
  turn.items.push(item);
  await link.send({ kind: 'event', event: { method: 'turn/completed', params: { threadId: thread.id, turn } } });
}
