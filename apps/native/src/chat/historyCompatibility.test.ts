import { expect, it, vi } from 'vitest';
import { HistoryReader } from '../../../../shared/remote-chat/client/historyReader';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { historyDelta, type HistoryVersion } from '../../../../shared/remote-chat/historySync';
import { sliceHistory, type HistoryWindow } from '../../../../shared/remote-chat/historyPage';
import type { Thread } from './types';

const unsupported = '当前手机端暂不支持此操作。';
const thread: Thread = { id: 'old', name: '旧聊天', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'completed', items: Array.from({ length: 35 }, (_, index) => ({
    id: `item-${index}`, type: 'agentMessage', text: `历史 ${index}`,
  })) }] };
const selected = { ...thread, turns: [] };
const count = (value: Thread) => value.turns?.flatMap((turn) => turn.items).length;

it('falls back once for old PCs, keeps ten-item pages, and probes again after reconnect', async () => {
  const request = vi.fn(async (body: { operation: string }) => {
    if (body.operation === 'syncHistory') throw new Error(unsupported);
    return { thread };
  });
  const reader = new HistoryReader(request as ConstructorParameters<typeof HistoryReader>[0]);
  let result = await reader.read(selected, {});
  expect(count(result.thread)).toBe(10);
  expect(result.page.hasMore).toBe(true);
  for (const size of [20, 30, 35]) {
    result = await reader.read(result.thread, { start: result.page.start, older: true });
    expect(count(result.thread)).toBe(size);
  }
  expect(result.page.hasMore).toBe(false);
  expect(request.mock.calls.map(([body]) => body.operation)).toEqual(['syncHistory', 'read', 'read', 'read', 'read']);
  reader.reset();
  await reader.read(selected, {});
  expect(request.mock.calls.filter(([body]) => body.operation === 'syncHistory')).toHaveLength(2);
});

it('paginates old incremental responses that ignore the requested window', async () => {
  const reader = new HistoryReader((async (body: { known?: HistoryVersion }) => {
    return historyDelta(thread, body.known);
  }) as ConstructorParameters<typeof HistoryReader>[0]);
  const first = await reader.read(selected, {});
  expect(count(first.thread)).toBe(10);
  const second = await reader.read(first.thread, { start: first.page.start, older: true });
  expect(count(second.thread)).toBe(20);
});

it('does not fall back for authorization, timeout, or malformed response errors', async () => {
  for (const message of ['没有权限', '请求超时']) {
    const request = vi.fn().mockRejectedValue(new Error(message));
    const reader = new HistoryReader(request);
    await expect(reader.read(selected, {})).rejects.toThrow(message);
    expect(request).toHaveBeenCalledTimes(1);
  }
  const request = vi.fn().mockResolvedValue({});
  await expect(new HistoryReader(request).read(selected, {})).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not issue a fallback after the connection has changed', async () => {
  let reject: (error: Error) => void = () => {};
  const request = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
  const reader = new HistoryReader(request as ConstructorParameters<typeof HistoryReader>[0]);
  const pending = reader.read(selected, {});
  reader.reset();
  reject(new Error(unsupported));
  await expect(pending).rejects.toThrow(unsupported);
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves live replies during a legacy read and ignores an old selection arriving late', async () => {
  let events: ConnectionEvents;
  let finish: (response: { thread: Thread }) => void = () => {};
  const request = vi.fn(async (method: string, body?: { operation: string }) => {
    if (method === 'connect') return [];
    if (body?.operation === 'syncHistory') throw new Error(unsupported);
    if (body?.operation === 'read') return new Promise((resolve) => { finish = resolve; });
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController((handlers) => {
    events = handlers;
    return { start() { handlers.mode('relay'); handlers.ready(); }, stop() {}, request } as unknown as ChatConnection;
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  const pending = controller.select(selected);
  await vi.waitFor(() => expect(request.mock.calls.some(([, body]) => body?.operation === 'read')).toBe(true));
  events!.event({ method: 'item/agentMessage/delta', params: {
    threadId: thread.id, turnId: 'live', itemId: 'live-item', delta: '实时回复',
  } });
  finish({ thread });
  await pending;
  expect(controller.snapshot().error).toBe('');
  expect(controller.snapshot().selected?.turns?.at(-1)?.items[0].text).toBe('实时回复');
  const oldRead = controller.refreshSelected();
  const finishOld = finish;
  const newer = { ...selected, id: 'newer' };
  const newRead = controller.select(newer);
  finish({ thread: newer }); await newRead;
  finishOld({ thread }); await oldRead;
  expect(controller.snapshot().selected?.id).toBe('newer');
  controller.stop();
});

it('keeps the normal paged response and empty completed turn used for read receipts', async () => {
  const reader = new HistoryReader((async (body: { window: HistoryWindow; known: HistoryVersion }) => {
    const page = sliceHistory(thread, body.window);
    return { ...historyDelta(page.thread, body.known), page: page.page };
  }) as ConstructorParameters<typeof HistoryReader>[0]);
  const result = await reader.read(selected, {});
  expect(count(result.thread)).toBe(10);
  const empty = { ...selected, turns: [{ id: 'done', status: 'completed', items: [] }] };
  expect(sliceHistory(empty).thread).toEqual(empty);
});
