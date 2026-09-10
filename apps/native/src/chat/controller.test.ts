import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from './controller';
import type { AuthSession } from '../types';
import type { Thread } from './types';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';

const mocks = vi.hoisted(() => ({ request: vi.fn(), events: null as ConnectionEvents | null }));
vi.mock('./connection', () => ({ MobileChatConnection: class {
  constructor(events: ConnectionEvents) { mocks.events = events; }
  start() { mocks.events!.mode('relay'); mocks.events!.ready(); }
  stop() {}
  request = mocks.request;
} }));
const session: AuthSession = { baseUrl: 'https://test', accessToken: 'test', refreshToken: 'test', email: 'test' };
const thread: Thread = { id: 'chat', preview: '', cwd: '/project', updatedAt: 1, turns: [] };
beforeEach(() => { mocks.request.mockReset(); });
afterEach(() => vi.useRealTimers());

async function connectedController() {
  mocks.request.mockImplementation(async (method) => method === 'connect' ? [] : { data: [], nextCursor: null });
  const controller = new ChatController(session, 'computer');
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  mocks.request.mockReset();
  return controller;
}

describe('mobile chat actions', () => {
  it('creates an active chat when starting from archived search results', async () => {
    const controller = await connectedController();
    mocks.request.mockResolvedValueOnce({ data: [], nextCursor: null }).mockResolvedValue({ thread });
    await controller.list({ archived: true, search: 'old chat' });
    expect(controller.snapshot().archived).toBe(true);
    expect(await controller.send({ text: 'new task', access: 'workspace-write' })).toBe(true);
    expect(controller.snapshot()).toMatchObject({ archived: false, search: '', selected: thread });
    expect(mocks.request.mock.calls.map(([, body]) => body.operation)).toEqual(['list', 'start', 'send', 'read']);
  });

  it('resumes the existing PC thread and does not silently replace its model', async () => {
    const controller = await connectedController();
    mocks.request.mockResolvedValue({ thread });
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
    const controller = await connectedController();
    const running = { ...thread, turns: [{ id: 'turn', status: 'inProgress', items: [] }] };
    mocks.request.mockResolvedValue({ thread: running });
    await controller.select(running);
    await controller.send({ text: 'add detail', access: 'workspace-write' });
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'steer', threadId: 'chat', turnId: 'turn', text: 'add detail', images: [], skills: [],
    });
    await controller.interrupt();
    expect(mocks.request).toHaveBeenCalledWith('request', { operation: 'interrupt', threadId: 'chat', turnId: 'turn' });
  });

  it('keeps the newer selection when an older history request finishes later', async () => {
    const controller = await connectedController();
    let completeFirst: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { completeFirst = resolve; }));
    const first = controller.select(thread);
    const second = { ...thread, id: 'second', name: 'Second task' };
    mocks.request.mockResolvedValue({ thread: second });
    await controller.select(second);
    completeFirst({ thread });
    await first;
    expect(controller.snapshot().selected?.id).toBe('second');
  });

  it('does not overlap history polls or duplicate sends while a request is pending', async () => {
    const controller = await connectedController();
    let completeRead: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { completeRead = resolve; }));
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

  it('blocks sending until PC initialization finishes and retries a failed initialization', async () => {
    vi.useFakeTimers();
    mocks.request.mockRejectedValueOnce(new Error('电脑暂未就绪'))
      .mockImplementation(async (method) => method === 'connect' ? [] : { data: [], nextCursor: null });
    const controller = new ChatController(session, 'computer');
    controller.start();
    expect(await controller.send({ text: 'test', access: 'read-only' })).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(controller.snapshot()).toMatchObject({ ready: true, error: '' });
    expect(mocks.request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(2);
    expect(mocks.request.mock.calls.some(([, body]) => body?.operation === 'send')).toBe(false);
    controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not continue a partially prepared send after the connection changes', async () => {
    const controller = await connectedController();
    let finish: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const sent = controller.send({ text: 'test', access: 'read-only' });
    mocks.events!.mode('offline');
    finish({ thread });
    expect(await sent).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().ready).toBe(false);
  });

  it('recovers a stopped PC process through the existing connection', async () => {
    const controller = await connectedController();
    vi.useFakeTimers();
    mocks.request.mockImplementation(async (method) => method === 'connect' ? [] : { data: [], nextCursor: null });
    mocks.events!.event({ method: 'connection/closed', params: {} });
    expect(controller.snapshot().ready).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(controller.snapshot().ready).toBe(true);
    controller.stop();
  });
});
