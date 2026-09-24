import { afterEach, expect, it, vi } from 'vitest';
import { contentHash, historyVersion } from '../../../../shared/remote-chat/historySync';
import { AsyncHistoryVersionCache } from '../../../../shared/remote-chat/client/historyPreparation';
import { HistoryReader } from '../../../../shared/remote-chat/client/historyReader';
import { RecordEncoder, THREAD_CHAR_LIMIT } from './offline/records';
import type { Thread } from './types';

const runtime = vi.hoisted(() => ({ Platform: { OS: 'android' },
  NativeModules: { ChatHistoryWorker: undefined as unknown } }));
vi.mock('react-native', () => runtime);
import { createHistoryPreparer } from './historyPreparation';

const thread = (): Thread => ({ id: 'chat', cwd: '', preview: '', updatedAt: 1, turns: [
  { id: 'turn', status: 'completed', items: [
    { id: 'one', type: 'agentMessage', text: '你好\0🌍\n\ud800' },
    { id: 'two', type: 'agentMessage', text: 'second' },
  ] }, { id: 'empty', status: 'completed', items: [] },
] });

function fakeWorker() {
  const prepare = vi.fn(async (batch: string[]) => batch.map((data) => ({ hash: contentHash(data),
    fields: Object.fromEntries(Object.entries(JSON.parse(data) as Record<string, unknown>).map(([key, value]) =>
      [key, { hash: contentHash(value), ...(typeof value === 'string' ? { length: value.length } : {}) }])),
  })));
  runtime.NativeModules.ChatHistoryWorker = { prepare };
  return prepare;
}
afterEach(() => { runtime.Platform.OS = 'android'; runtime.NativeModules.ChatHistoryWorker = undefined; });

it('preserves manifests, cache bytes, signatures and immutable identity across both consumers', async () => {
  const worker = fakeWorker();
  const prepare = createHistoryPreparer()!;
  const versions = new AsyncHistoryVersionCache(prepare);
  const original = thread();
  const before = await versions.read(original);
  expect(before).toEqual(historyVersion(original));
  expect(await new RecordEncoder(prepare).encode(original)).toEqual(await new RecordEncoder().encode(original));
  const count = worker.mock.calls.flatMap(([batch]) => batch).length;
  expect((await versions.read(original)).turns[0]).toBe(before.turns[0]);
  expect(worker.mock.calls.flatMap(([batch]) => batch)).toHaveLength(count);
  const turn = original.turns![0];
  const changed = { ...original, turns: [{ ...turn, items: [turn.items[0], { ...turn.items[1], text: 'updated' }] }] };
  expect(await versions.read(changed)).toEqual(historyVersion(changed));
  expect(worker.mock.calls.flatMap(([batch]) => batch)).toHaveLength(count + 3);
});

it('bounds bridge batches and never overlaps native worker requests', async () => {
  const worker = fakeWorker();
  const prepare = createHistoryPreparer()!;
  let active = 0;
  const implementation = worker.getMockImplementation()!;
  worker.mockImplementation(async (batch) => {
    expect(++active).toBe(1);
    const result = await implementation(batch);
    active--;
    return result;
  });
  const source = Array.from({ length: 70 }, (_, id) => ({ id, text: 'x'.repeat(20_000) }));
  await Promise.all(source.map((value) => prepare(value)));
  expect(worker.mock.calls.length).toBeGreaterThan(1);
  for (const [batch] of worker.mock.calls) {
    expect(batch.length).toBeLessThanOrEqual(16);
    expect(batch.reduce((size, value) => size + value.length, 0)).toBeLessThan(150_000);
  }
});

it('does not send a stale request when the connection resets during preparation', async () => {
  let finish: (value: ReturnType<typeof historyVersion>) => void = () => {};
  const request = vi.fn();
  const reader = new HistoryReader(request, { read: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = reader.read(thread(), {});
  reader.reset();
  finish(historyVersion(thread()));
  await expect(pending).rejects.toThrow('聊天连接已更新');
  expect(request).not.toHaveBeenCalled();
});

it('retries failed objects without poisoning other batches or silently falling back to JS', async () => {
  const worker = fakeWorker();
  worker.mockRejectedValueOnce(new Error('worker failed'));
  const prepare = createHistoryPreparer()!;
  const value = thread();
  await expect(prepare(value, 'turns')).rejects.toThrow('worker failed');
  expect((await prepare(value, 'turns')).fields).toEqual(historyVersion(value).fields);
  runtime.Platform.OS = 'ios';
  expect(createHistoryPreparer()).toBeUndefined();
});

it('retains exactly the same contiguous cache suffix when messages exceed the budget', async () => {
  fakeWorker();
  const value = thread();
  value.turns![0].items[0].text = 'x'.repeat(THREAD_CHAR_LIMIT);
  expect(await new RecordEncoder(createHistoryPreparer()).encode(value))
    .toEqual(await new RecordEncoder().encode(value));
});
