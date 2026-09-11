import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
import type { GuiEvent, Thread } from '../pages/codexGui/types';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { applyHistoryDelta, historyVersion } from '../../../../shared/remote-chat/historySync';
import { sliceHistory, type PagedHistoryDelta } from '../../../../shared/remote-chat/historyPage';
import { EventStream } from './eventStream';

vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

function conversation(count = 35): Thread {
  return { id: 'chat', preview: '', cwd: '', updatedAt: 1, turns: [0, 1, 2].map((group) => ({
    id: `turn-${group}`, status: 'completed', items: Array.from({ length: count }, (_, index) => ({
      id: `item-${index}`, type: 'agentMessage', text: `Message ${index}`,
    })).filter((_, index) => Math.floor(index / 12) === group),
  })) };
}

it('transfers the newest ten items from oversized history and exactly ten older bodies per page', async () => {
  const remote = conversation();
  for (const item of remote.turns![0].items) item.text = 'old'.repeat(250_000);
  expect(JSON.stringify(remote).length).toBeGreaterThan(8 * 1024 * 1024);
  vi.mocked(guiApi.request).mockResolvedValue({ thread: remote });
  const operations = new ChatOperations();
  let selected: Thread = { ...remote, turns: [] };
  let page: PagedHistoryDelta['page'];
  for (const [index, expected] of [10, 20, 30, 35].entries()) {
    const response = await operations.execute({ kind: 'request', id: `page-${index}`, method: 'request',
      body: { operation: 'syncHistory', threadId: remote.id, known: historyVersion(selected),
        window: { start: page?.start, older: index > 0 } } });
    expect(response.error).toBeUndefined();
    const delta = response.data as PagedHistoryDelta;
    expect(delta.turns.flatMap((turn) => turn.items)).toHaveLength(index === 3 ? 5 : 10);
    if (index === 0) expect(JSON.stringify(delta).length).toBeLessThan(5000);
    selected = applyHistoryDelta(selected, delta);
    expect(selected.turns!.flatMap((turn) => turn.items)).toHaveLength(expected);
    page = delta.page;
    expect(page?.hasMore).toBe(index < 3);
  }
});

it('keeps page anchors stable when new messages arrive and recovers from a deleted cursor', () => {
  const remote = conversation();
  const first = sliceHistory(remote);
  remote.turns!.at(-1)!.items.push({ id: 'new', type: 'agentMessage', text: 'new reply' });
  const second = sliceHistory(remote, { start: first.page.start, older: true });
  expect(second.thread.turns!.flatMap((turn) => turn.items)).toHaveLength(21);
  expect(second.page.start?.itemId).toBe('item-15');
  const reset = sliceHistory(remote, { start: { turnId: 'missing', itemId: 'deleted' }, older: true });
  expect(reset.thread.turns!.flatMap((turn) => turn.items)).toHaveLength(10);
});

async function connected(remote: Thread) {
  const operations = new ChatOperations();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === 'read'
    ? { thread: structuredClone(remote) } : { data: [], nextCursor: null });
  let handlers: ConnectionEvents;
  let serial = 0;
  const stream = new EventStream((event) => handlers.event(event));
  const controller = new ChatController((events) => {
    handlers = events;
    return { start() { events.mode('relay'); events.ready(); }, stop() {},
      async request(method, body) {
        if ((body as { operation?: string })?.operation === 'models') return { data: [], nextCursor: null };
        const response = await operations.execute({ kind: 'request', id: String(++serial), method, body });
        if (response.error) throw new Error(response.error);
        stream.flush();
        return response.data;
      },
    } as ChatConnection;
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  return { controller, stream, emit: (event: GuiEvent) => stream.receive(operations.prepareEvent(event)) };
}

it('streams before completion even when disk history stays stale, without replaying text on refresh', async () => {
  const remote = conversation(2);
  const { controller, stream, emit } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  vi.useFakeTimers();
  emit({ method: 'turn/started', params: { threadId: remote.id,
    turn: { id: 'active', status: 'inProgress', items: [] } } });
  emit({ method: 'item/started', params: { threadId: remote.id, turnId: 'active',
    item: { id: 'answer', type: 'agentMessage', text: '' } } });
  for (const delta of ['hello', ' world']) emit({ method: 'item/agentMessage/delta', params: {
    threadId: remote.id, turnId: 'active', itemId: 'answer', delta,
  } });
  await vi.advanceTimersByTimeAsync(40);
  expect(controller.snapshot().selected?.turns?.at(-1)).toMatchObject({ status: 'inProgress',
    items: [{ text: 'hello world' }] });
  await controller.refreshSelected();
  expect(controller.snapshot().selected?.turns?.at(-1)?.items[0].text).toBe('hello world');
  emit({ method: 'turn/completed', params: { threadId: remote.id,
    turn: { id: 'active', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'hello world' }] } } });
  await vi.advanceTimersByTimeAsync(100);
  expect(controller.snapshot().selected?.turns?.at(-1)).toMatchObject({ status: 'completed',
    items: [{ text: 'hello world' }] });
  controller.stop();
  stream.close();
  expect(vi.getTimerCount()).toBe(0);
});

it('loads earlier items only once and ignores an older page after leaving the conversation', async () => {
  const remote = conversation();
  const { controller, stream } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  let finish!: (value: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const count = vi.mocked(guiApi.request).mock.calls.length;
  const older = controller.loadOlder();
  expect(controller.snapshot()).toMatchObject({ historyLoading: true, historyLoadingMore: true });
  await controller.loadOlder();
  await controller.refreshSelected();
  expect(vi.mocked(guiApi.request).mock.calls.length).toBe(count + 1);
  controller.back();
  finish({ thread: remote });
  await older;
  expect(controller.snapshot()).toMatchObject({ selected: null, historyLoading: false, historyLoadingMore: false });
  controller.stop();
  stream.close();
});

it('joins a running reply during a delayed read without losing its prefix or replaying buffered tokens', async () => {
  const remote: Thread = { id: 'chat', preview: '', cwd: '', updatedAt: 1, turns: [{ id: 'active',
    status: 'inProgress', startedAt: Date.now() / 1000,
    items: [{ id: 'answer', type: 'agentMessage', text: 'hello' }] }] };
  const { controller, stream, emit } = await connected(remote);
  emit({ method: 'turn/started', params: { threadId: remote.id, turn: remote.turns![0] } });
  let finish!: (value: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const reading = controller.select({ ...remote, turns: [] });
  vi.useFakeTimers();
  emit({ method: 'item/agentMessage/delta', params: {
    threadId: remote.id, turnId: 'active', itemId: 'answer', delta: ' world',
  } });
  await vi.advanceTimersByTimeAsync(40);
  emit({ method: 'thread/tokenUsage/updated', params: { threadId: remote.id } });
  emit({ method: 'item/agentMessage/delta', params: {
    threadId: remote.id, turnId: 'active', itemId: 'answer', delta: '!',
  } });
  finish({ thread: remote });
  await reading;
  await vi.advanceTimersByTimeAsync(40);
  expect(controller.snapshot().selected?.turns?.[0].items[0].text).toBe('hello world!');
  controller.stop();
  stream.close();
  expect(vi.getTimerCount()).toBe(0);
});

it('queues one older page behind a background refresh instead of dropping the scroll request', async () => {
  const remote = conversation();
  const { controller, stream } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  const before = vi.mocked(guiApi.request).mock.calls.length;
  let finish!: (value: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const refresh = controller.refreshSelected();
  await controller.loadOlder();
  await controller.loadOlder();
  expect(controller.snapshot().historyLoadingMore).toBe(true);
  expect(vi.mocked(guiApi.request).mock.calls.length).toBe(before + 1);
  finish({ thread: remote });
  await refresh;
  await vi.waitFor(() => expect(controller.snapshot().historyLoading).toBe(false));
  expect(vi.mocked(guiApi.request).mock.calls.length).toBe(before + 2);
  expect(controller.snapshot().selected?.turns?.flatMap((turn) => turn.items)).toHaveLength(20);
  controller.stop();
  stream.close();
});
vi.mock('./queue', () => ({ remoteQueue: { request: async () => ({ revision: 0, threads: {} }) } }));
