import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from './controller';
import type { AuthSession } from '../types';
import type { Thread } from './types';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./connection', () => ({ MobileChatConnection: class {
  start() {}
  stop() {}
  request = mocks.request;
} }));
const session: AuthSession = { baseUrl: 'https://test', accessToken: 'test', refreshToken: 'test', email: 'test' };
const thread: Thread = { id: 'chat', preview: '', cwd: '/project', updatedAt: 1, turns: [] };
beforeEach(() => { mocks.request.mockReset(); });

describe('mobile chat actions', () => {
  it('resumes the existing PC thread and does not silently replace its model', async () => {
    mocks.request.mockResolvedValue({ thread });
    const controller = new ChatController(session, 'computer');
    await controller.select(thread);
    expect(await controller.send({ text: 'continue', access: 'workspace-write' })).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'resume', threadId: 'chat', access: 'workspace-write',
    });
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'send', threadId: 'chat', text: 'continue', access: 'workspace-write', images: [],
    });
  });

  it('steers an active PC turn and stops that same turn', async () => {
    const running = { ...thread, turns: [{ id: 'turn', status: 'inProgress', items: [] }] };
    mocks.request.mockResolvedValue({ thread: running });
    const controller = new ChatController(session, 'computer');
    await controller.select(running);
    await controller.send({ text: 'add detail', access: 'workspace-write' });
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'steer', threadId: 'chat', turnId: 'turn', text: 'add detail', images: [], skills: [],
    });
    await controller.interrupt();
    expect(mocks.request).toHaveBeenCalledWith('request', { operation: 'interrupt', threadId: 'chat', turnId: 'turn' });
  });

  it('keeps the newer selection when an older history request finishes later', async () => {
    let completeFirst: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { completeFirst = resolve; }));
    const controller = new ChatController(session, 'computer');
    const first = controller.select(thread);
    const second = { ...thread, id: 'second', name: 'Second task' };
    mocks.request.mockResolvedValue({ thread: second });
    await controller.select(second);
    completeFirst({ thread });
    await first;
    expect(controller.snapshot().selected?.id).toBe('second');
  });

  it('does not overlap history polls or duplicate sends while a request is pending', async () => {
    let completeRead: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { completeRead = resolve; }));
    const controller = new ChatController(session, 'computer');
    const read = controller.select(thread);
    await controller.refreshSelected();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    completeRead({ thread });
    await read;
    mocks.request.mockRejectedValue(new Error('offline'));
    const send = controller.send({ text: 'test', access: 'read-only' });
    expect(await controller.send({ text: 'duplicate', access: 'read-only' })).toBe(false);
    const sent = await send;
    expect(sent).toBe(false);
    expect(controller.snapshot().sending).toBe(false);
    expect(controller.snapshot().error).toBe('offline');
  });
});
