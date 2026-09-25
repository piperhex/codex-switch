// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { deleteRemoteThread } from './threadActions';

const mocks = vi.hoisted(() => ({ deleteThread: vi.fn(), connect: vi.fn(),
  state: { connection: 'ready', error: '' } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: () => ({
  getSnapshot: () => mocks.state, deleteThread: mocks.deleteThread, connect: mocks.connect,
}) }));
beforeEach(() => { vi.resetAllMocks(); mocks.state = { connection: 'ready', error: '' }; });

it('routes and deduplicates remote deletion through desktop safeguards', async () => {
  mocks.deleteThread.mockResolvedValue(true);
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const, id: 'delete-one',
    body: { operation: 'delete', threadId: 'one' } };
  expect(await operations.execute(request)).toMatchObject({ data: {} });
  expect(await operations.execute(request)).toMatchObject({ data: {} });
  expect(mocks.deleteThread).toHaveBeenCalledExactlyOnceWith('one');
});

it('surfaces a rejected desktop deletion instead of acknowledging success', async () => {
  mocks.deleteThread.mockResolvedValue(false);
  mocks.state.error = '请等待回复结束，并处理待发送消息后再删除对话。';
  await expect(deleteRemoteThread('one')).rejects.toThrow(mocks.state.error);
});

it.each([undefined, '', '   ', 123, 'a'.repeat(201)])('rejects an invalid thread id: %s', async id => {
  await expect(deleteRemoteThread(id)).rejects.toThrow('有效的对话');
  expect(mocks.deleteThread).not.toHaveBeenCalled();
});
