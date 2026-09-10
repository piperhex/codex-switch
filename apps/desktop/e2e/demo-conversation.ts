import type { RpcRequest } from '../../../shared/remote-chat/protocol';
import type { ChatLink } from '../../../shared/remote-chat/link';
import type { GuiEvent, Item, Thread, Turn } from '../src/pages/codexGui/types';
import previewImage from '../src-tauri/icons/32x32.png?inline';

const welcome: Thread = { id: 'demo-chat', name: '移动端聊天体验', preview: '继续电脑上的任务', cwd: 'F:/projects/demo',
  updatedAt: Math.floor(Date.now() / 1000), turns: [{ id: 'welcome', status: 'completed', items: [
    { id: 'question', type: 'userMessage', content: [{ type: 'text', text: '帮我整理今天的工作计划。' }] },
    { id: 'answer', type: 'agentMessage', text: '可以，今天先完成这三件事：\n\n1. 检查项目进度\n2. 处理需要确认的事项'
      + '\n3. 验证手机与电脑之间的同步\n\n你可以直接从手机继续这个任务。' },
  ] }] };
const threads = new Map([[welcome.id, welcome]]);
const archived = new Set<string>();
const approvals = new Map<string, { event: GuiEvent; thread: Thread; turn: Turn; link: ChatLink }>();
const operations: Record<string, unknown>[] = [];
const streamErrors: string[] = [];
let sequence = 0;
const uniqueId = (name: string) => `${name}-${++sequence}`;

export function demoState() {
  return { threads: [...threads.values()], operations, approvals: [...approvals.values()].map(({ event }) => event),
    streamErrors, archived: [...archived] };
}

export function demoResponse(request: RpcRequest, link: ChatLink): unknown {
  if (request.method === 'connect') return [...approvals.values()].map(({ event }) => event);
  const input = (request.body ?? {}) as Record<string, unknown>;
  operations.push({ ...input, method: request.method });
  if (request.method === 'respond') return respond(input);
  if (input.operation === 'models') return { data: [{ id: 'demo', model: 'test-model', displayName: '测试模型',
    isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: '标准' }, { reasoningEffort: 'high', description: '深入' },
    ] }], nextCursor: null };
  if (input.operation === 'list') return { data: [...threads.values()].filter((thread) =>
    archived.has(thread.id) === (input.archived === true)
      && `${thread.name} ${thread.preview}`.includes(String(input.search ?? ''))), nextCursor: null };
  if (input.operation === 'start') {
    const thread: Thread = { id: uniqueId('chat'), name: '手机新聊天', preview: '', cwd: 'F:/projects/demo',
      updatedAt: Math.floor(Date.now() / 1000), turns: [] };
    threads.set(thread.id, thread);
    return { thread };
  }
  const thread = threads.get(String(input.threadId));
  if (!thread) throw new Error('Unknown demo thread');
  return threadOperation(thread, input, link);
}

function threadOperation(thread: Thread, input: Record<string, unknown>, link: ChatLink) {
  if (input.operation === 'resume' && !thread.turns?.length) {
    throw new Error('New threads have no persisted rollout before the first turn');
  }
  if (input.operation === 'read' || input.operation === 'resume') return { thread };
  if (input.operation === 'imagePreview') return { url: previewImage };
  if (input.operation === 'archive') { archived.add(thread.id); return {}; }
  if (input.operation === 'unarchive') { archived.delete(thread.id); return {}; }
  if (input.operation === 'send') return { turn: startTurn(thread, String(input.text), link) };
  const turn = thread.turns?.find((entry) => entry.id === input.turnId);
  if (input.operation === 'interrupt' && turn) {
    finish({ thread, turn, link }, 'interrupted');
    return {};
  }
  if (input.operation === 'steer' && turn) {
    const item: Item = { id: uniqueId('steer'), type: 'userMessage',
      content: [{ type: 'text', text: String(input.text) }] };
    turn.items.push(item);
    notify(link, { method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item } });
  }
  return {};
}

function notify(link: ChatLink, event: GuiEvent) {
  void link.send({ kind: 'event', event: structuredClone(event) }).catch((error: unknown) => {
    streamErrors.push(error instanceof Error ? error.message : 'Could not send demo event');
  });
}

function startTurn(thread: Thread, text: string, link: ChatLink) {
  const turn: Turn = { id: uniqueId('turn'), status: 'inProgress', items: [
    { id: uniqueId('user'), type: 'userMessage', content: [{ type: 'text', text }] },
  ] };
  thread.turns?.push(turn);
  thread.preview = text;
  notify(link, { method: 'turn/started', params: { threadId: thread.id, turn } });
  if (text.includes('approval') || text.includes('question')) requestApproval({ thread, turn, link }, text);
  else if (text.includes('image preview')) previewTurn({ thread, turn, link }, text);
  else void stream({ thread, turn, link }, text.includes('slow'));
  return turn;
}

interface Context { thread: Thread; turn: Turn; link: ChatLink }

function previewTurn(context: Context, text: string) {
  const local = text.includes('remote image preview') ? '' : '![本地图片](./preview.png)\n\n';
  const remote = text.includes('local image preview') ? ''
    : '![网络图片](http://127.0.0.1:1490/test/preview.png)\n\n';
  const item: Item = { id: uniqueId('image'), type: 'agentMessage', text: '图片前的文字。\n\n'
    + local + remote + '图片后的文字。' };
  context.turn.items.push(item);
  notify(context.link, { method: 'item/completed',
    params: { threadId: context.thread.id, turnId: context.turn.id, item } });
  finish(context);
}

function finish(context: Context, status = 'completed') {
  context.turn.status = status;
  notify(context.link, { method: 'turn/completed', params: { threadId: context.thread.id, turn: context.turn } });
}

async function stream(context: Context, slow: boolean) {
  const { thread, turn, link } = context;
  const item: Item = { id: uniqueId('response'), type: 'agentMessage', text: '' };
  turn.items.push(item);
  notify(link, { method: 'item/started', params: { threadId: thread.id, turnId: turn.id, item } });
  const parts = ['已经收到你的消息。', '\n\n手机和电脑正在同步。', '\n\n```typescript\n',
    'const connected = true;\n', '```\n', '\n这条回复用于验证实际移动端的收发和显示。'];
  for (const delta of slow ? Array.from({ length: 60 }, () => '处理中…\n') : parts) {
    if (turn.status !== 'inProgress') return;
    item.text += delta;
    notify(link, { method: 'item/agentMessage/delta', params: { threadId: thread.id, turnId: turn.id,
      itemId: item.id, delta } });
    await new Promise((resolve) => setTimeout(resolve, slow ? 1000 : 450));
  }
  finish(context);
}

function requestApproval(context: Context, text: string) {
  const id = uniqueId('approval');
  const question = text.includes('question');
  const event: GuiEvent = { id,
    method: question ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval',
    params: { threadId: context.thread.id, turnId: context.turn.id, reason: '用于验证手机上的确认流程。',
      ...(question ? { questions: [{ id: 'choice', header: '选择', question: '请选择下一步', options: [
        { label: '继续验证', description: '检查手机和电脑的同步' }, { label: '稍后处理', description: '暂时结束本次验证' },
      ] }] } : { command: 'npm test', availableDecisions: ['accept', 'decline'] }) } };
  approvals.set(id, { ...context, event });
  notify(context.link, event);
}

function respond(input: Record<string, unknown>) {
  const pending = approvals.get(String(input.id));
  if (!pending) throw new Error('Unknown demo approval');
  approvals.delete(String(input.id));
  notify(pending.link, { method: 'serverRequest/resolved', params: { requestId: String(input.id) } });
  finish(pending, input.decision === 'decline' ? 'interrupted' : 'completed');
  return {};
}
