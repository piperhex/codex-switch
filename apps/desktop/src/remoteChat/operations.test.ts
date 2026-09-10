// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
import { remoteQueue } from './queue';
vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

it('executes a retried mutation once even while the original is still running', async () => {
  let finish: (value: unknown) => void = () => undefined;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'phone:1', method: 'request' as const,
    body: { operation: 'send', text: 'continue', threadId: 'thread' } };
  const first = operations.execute(request);
  const retry = operations.execute(request);
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  finish({ turn: { id: 'turn' } });
  expect(await first).toEqual(await retry);
  expect(await operations.execute(request)).toEqual(await first);
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  await expect(operations.execute({ ...request, body: { ...request.body, text: 'different' } })).rejects.toThrow();
});

it('acknowledges a retried enqueue only once through the PC queue', async () => {
  const enqueue = vi.spyOn(remoteQueue, 'request').mockResolvedValue({ revision: 1, threads: {} });
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'queue:1', method: 'request' as const,
    body: { operation: 'queueEnqueue', threadId: 'phone', text: 'next', images: [] } };
  expect(await operations.execute(request)).toEqual(await operations.execute(request));
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(guiApi.request).not.toHaveBeenCalled();
  enqueue.mockRestore();
});

it('blocks arbitrary operations before reaching the desktop boundary', async () => {
  const result = await new ChatOperations().execute({ kind: 'request', id: 'invalid', method: 'request',
    body: { operation: 'execute_command', command: 'private operation' } });
  expect(result.error).toContain('暂不支持');
  expect(guiApi.request).not.toHaveBeenCalled();
});

it('preserves a running desktop session when a phone reconnects', async () => {
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  await new ChatOperations().execute({ kind: 'request', id: 'connect', method: 'connect' });
  expect(guiApi.connect).toHaveBeenCalledWith({ reuseExisting: true });
});

it('keeps accepting mutations after more than 512 incremental polls', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
  const operations = new ChatOperations();
  for (let index = 0; index < 550; index++) {
    const result = await operations.execute({ kind: 'request', id: `poll:${index}`, method: 'request',
      body: { operation: 'list' } });
    expect(result.error).toBeUndefined();
  }
  const result = await operations.execute({ kind: 'request', id: 'send', method: 'request',
    body: { operation: 'send', threadId: 'chat', text: 'continue' } });
  expect(result.error).toBeUndefined();
});

it('preserves the safe error string returned by Tauri', async () => {
  vi.mocked(guiApi.request).mockRejectedValue('Codex 已断开连接，请重新连接后继续。');
  const result = await new ChatOperations().execute({ kind: 'request', id: 'read', method: 'request',
    body: { operation: 'read', threadId: 'chat' } });
  expect(result.error).toBe('Codex 已断开连接，请重新连接后继续。');
});

it('returns a bounded error for an oversized preview and still handles the next request', async () => {
  vi.mocked(guiApi.request).mockResolvedValueOnce({ url: 'a'.repeat(8 * 1024 * 1024) }).mockResolvedValue({ data: [] });
  const operations = new ChatOperations();
  const preview = await operations.execute({ kind: 'request', id: 'image', method: 'request',
    body: { operation: 'imagePreview', threadId: 'chat', source: 'large.png' } });
  expect(preview.error).toContain('图片暂时无法加载');
  expect(preview.data).toBeUndefined();
  expect(await operations.execute({ kind: 'request', id: 'list', method: 'request', body: { operation: 'list' } }))
    .toMatchObject({ data: { data: [] } });
});
