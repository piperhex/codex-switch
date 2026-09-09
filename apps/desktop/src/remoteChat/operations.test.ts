import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

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

it('blocks arbitrary operations before reaching the desktop boundary', async () => {
  const result = await new ChatOperations().execute({ kind: 'request', id: 'invalid', method: 'request',
    body: { operation: 'execute_command', command: 'private operation' } });
  expect(result.error).toContain('暂不支持');
  expect(guiApi.request).not.toHaveBeenCalled();
});
