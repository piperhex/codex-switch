import { expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { QUEUE_EVENT, type QueueSnapshot } from '../../../../shared/remote-chat/queue';

it('uses PC snapshots for reconnects, ignores old responses and prevents duplicate queue actions', async () => {
  let events!: ConnectionEvents;
  const thread = { id: 'chat', cwd: '', preview: '', updatedAt: 1, turns: [] };
  const first: QueueSnapshot = { revision: 2, threads: { chat: [
    { id: 'queued', text: 'next', imageCount: 0, attachmentCount: 0, busy: false },
  ] } };
  const request = vi.fn(async (method: string, body?: { operation?: string }): Promise<unknown> => {
    if (method === 'connect') return [];
    if (body?.operation === 'queueRead') return first;
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController((callbacks) => {
    events = callbacks;
    return { request: <T>(method: string, body?: { operation?: string }) => request(method, body) as Promise<T>,
      start: () => { events.mode('relay'); events.ready(); }, stop() {} };
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  expect(controller.snapshot().queue).toEqual(first);
  await controller.select(thread);
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const sending = controller.queueAction('queueSendNow', 'queued');
  await controller.queueAction('queueSendNow', 'queued');
  const newer = { revision: 4, threads: {} };
  events.event({ method: QUEUE_EVENT, params: newer });
  finish(first);
  await sending;
  expect(controller.snapshot().queue).toEqual(newer);
  expect(request.mock.calls.filter(([, body]) => body?.operation === 'queueSendNow')).toHaveLength(1);
  events.mode('offline'); events.mode('relay'); events.ready();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  expect(controller.snapshot().queue).toEqual(first);
  controller.stop();
});
