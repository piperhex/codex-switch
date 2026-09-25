import { afterEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { initialChatState, type Thread } from './types';
import { ThreadActions, threadActionReason } from '../../../../shared/remote-chat/client/threadActions';
import { historyDelta } from '../../../../shared/remote-chat/historySync';
import type { OfflineHistoryStore } from '../../../../shared/remote-chat/client/offline';

const thread: Thread = { id: 'one', name: 'Original', preview: '', cwd: '/project', updatedAt: 1, turns: [] };
const other: Thread = { ...thread, id: 'two', name: 'Other' };
const controllers: ChatController[] = [];
afterEach(() => { controllers.forEach(controller => controller.stop()); controllers.length = 0; });

async function setup() {
  let events!: ConnectionEvents;
  let threads = [thread, other];
  const offline: OfflineHistoryStore = { list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined),
    updateSummaries: vi.fn().mockResolvedValue(undefined), readImage: vi.fn(), saveImage: vi.fn() };
  const request = vi.fn(async (method: string, body?: unknown): Promise<unknown> => {
    if (method === 'connect') return [];
    const input = body as { operation: string; threadId: string; name?: string };
    if (input.operation === 'list') return { data: threads, nextCursor: null };
    if (input.operation === 'syncHistory') return historyDelta(threads.find(item => item.id === input.threadId)!);
    if (input.operation === 'rename') threads = threads.map(item => item.id === input.threadId
      ? { ...item, name: input.name } : item);
    if (['archive', 'unarchive', 'delete'].includes(input.operation)) {
      threads = threads.filter(item => item.id !== input.threadId);
    }
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController(callbacks => {
    events = callbacks;
    return { start() { events.mode('relay'); events.ready(); }, stop() {},
      request: <T>(method: string, body?: unknown) => request(method, body) as Promise<T> };
  }, offline);
  controllers.push(controller); controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  await controller.list();
  return { controller, request, events, offline };
}

it('renames an unopened conversation without selecting it or marking it read', async () => {
  const { controller, request, events } = await setup();
  await controller.select(other);
  events.event({ method: 'chat/sidebar/updated', params: { revision: 1,
    threads: { one: { cwd: '/project', title: 'Original', projectName: 'project', running: false } },
    readState: { one: { turnId: 'unread', unread: true } } } });
  request.mockClear();
  await controller.threadActions.run(thread, 'rename', '  New name  ');
  expect(request).toHaveBeenCalledWith('request', { operation: 'rename', threadId: 'one', name: 'New name' });
  expect(controller.snapshot().threads[0].name).toBe('New name');
  expect(controller.snapshot().sidebar.threads.one.title).toBe('New name');
  expect(controller.snapshot().sidebar.readState.one.unread).toBe(true);
  expect(controller.snapshot().selected?.id).toBe('two');
  expect(request.mock.calls.some(([, body]) => (body as { operation: string }).operation === 'threadRead')).toBe(false);
});

it.each(['archive', 'delete'] as const)('clears the selected conversation after %s and refreshes the list', async action => {
  const { controller, offline } = await setup();
  await controller.select(thread);
  await controller.threadActions.run(thread, action);
  await controller.flushCache();
  expect(controller.snapshot().selected).toBeNull();
  expect(controller.snapshot().threads.map(item => item.id)).toEqual(['two']);
  expect(controller.snapshot().threadActionBusy).toBeUndefined();
  if (action === 'delete') expect(offline.remove).toHaveBeenCalledWith('one');
  else expect(offline.updateSummaries).toHaveBeenCalledWith([thread], true);
});

it('keeps another selected conversation open when deleting from the list', async () => {
  const { controller } = await setup();
  await controller.select(other);
  await controller.threadActions.run(thread, 'delete');
  expect(controller.snapshot().selected?.id).toBe('two');
});

it('does not let a delayed history response restore a deleted conversation', async () => {
  const { controller, request, events, offline } = await setup();
  let resolve!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const selection = controller.select(thread);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  events.event({ method: 'thread/deleted', params: { threadId: 'one' } });
  resolve(historyDelta(thread)); await selection;
  expect(controller.snapshot().selected).toBeNull();
  expect(offline.remove).toHaveBeenCalledWith('one');
});

it('preserves the conversation on failure, releases the lock and allows retry', async () => {
  const { controller, request } = await setup();
  request.mockRejectedValueOnce(new Error('删除未完成'));
  await expect(controller.threadActions.run(thread, 'delete')).rejects.toThrow('删除未完成');
  expect(controller.snapshot().threads[0]).toEqual(thread);
  expect(controller.snapshot().threadActionBusy).toBeUndefined();
  await controller.threadActions.run(thread, 'delete');
  expect(controller.snapshot().threads).toEqual([other]);
});

it('rejects empty names, active replies, approvals, queued messages and offline mutations', async () => {
  const { controller, request } = await setup();
  request.mockClear();
  await expect(controller.threadActions.run(thread, 'rename', '  ')).rejects.toThrow('对话名称');
  expect(request).not.toHaveBeenCalled();
  const ready = { ...initialChatState(), ready: true };
  expect(threadActionReason(initialChatState(), thread, 'delete')).toContain('连接电脑');
  expect(threadActionReason(ready, { ...thread, status: { type: 'active' } }, 'archive')).toContain('回复结束');
  expect(threadActionReason({ ...ready, threads: [{ ...thread, status: { type: 'active' } }] },
    thread, 'delete')).toContain('回复结束');
  expect(threadActionReason({ ...ready, approvals: [{ method: 'approval', params: { threadId: 'one' } }] },
    thread, 'delete')).toContain('回复结束');
  const queued = { ...ready, queue: { revision: 1, threads: { one: [
    { id: 'queued', text: 'next', imageCount: 0, attachmentCount: 0, busy: false },
  ] } } };
  expect(threadActionReason(queued, thread, 'delete')).toContain('待发送消息');
  expect(threadActionReason(queued, thread, 'rename')).toBe('');
});

it('serializes repeated mutations and supports restoring archived chats', async () => {
  let state = { ...initialChatState(), ready: true };
  let finish!: () => void;
  const request = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const complete = vi.fn();
  const actions = new ThreadActions({ snapshot: () => state, update: patch => { state = { ...state, ...patch }; },
    request, complete, refresh: vi.fn().mockResolvedValue(undefined) });
  const pending = actions.run(thread, 'unarchive');
  await expect(actions.run(thread, 'delete')).rejects.toThrow('当前操作');
  expect(request).toHaveBeenCalledTimes(1);
  finish(); await pending;
  expect(complete).toHaveBeenCalledWith({ operation: 'unarchive', threadId: 'one' });
});
