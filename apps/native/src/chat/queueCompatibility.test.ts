import { expect, it, vi } from 'vitest';
import { QueueConnection } from '../../../../shared/remote-chat/client/queueConnection';

const unsupported = new Error('当前手机端暂不支持此操作。');
const thread = { id: 'chat', cwd: '/project', preview: '', updatedAt: 1, turns: [] };
const input = { text: '$review', images: ['data:image/jpeg;base64,aW1hZ2U='],
  skills: [{ name: 'review', path: '/skills/review/SKILL.md' }], access: 'workspace-write' as const };

it.each([false, true])('keeps images and skills when sending to an older PC (running: %s)', async (running) => {
  const request = vi.fn().mockRejectedValueOnce(unsupported).mockResolvedValue({});
  const queue = new QueueConnection(request);
  expect(await queue.read()).toBeNull();
  const selected = { ...thread, turns: running ? [{ id: 'turn', status: 'inProgress', items: [] }] : [] };
  await queue.enqueue(selected, input);
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({
    operation: running ? 'steer' : 'send', images: input.images, skills: input.skills,
  }));
  if (!running) expect(request).toHaveBeenCalledWith({
    operation: 'resume', threadId: thread.id, access: input.access,
  });
  request.mockClear(); queue.reset();
  await queue.enqueue(selected, input);
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'queueEnqueue', threadId: thread.id, ...input });
});

it('does not hide connection failures or resend a failed queued message through a second operation', async () => {
  const request = vi.fn().mockRejectedValue(new Error('Connection lost'));
  const queue = new QueueConnection(request);
  await expect(queue.read()).rejects.toThrow('Connection lost');
  request.mockClear();
  await expect(queue.enqueue(thread, input)).rejects.toThrow('Connection lost');
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'queueEnqueue', threadId: thread.id, ...input });
});

it('discards a late unsupported response after reconnecting to a queue-capable PC', async () => {
  let reject!: (reason: Error) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
    .mockResolvedValue({ revision: 1, threads: {} });
  const queue = new QueueConnection(request);
  const oldRead = queue.read();
  queue.reset();
  await queue.read();
  reject(unsupported);
  await expect(oldRead).rejects.toThrow();
  request.mockClear();
  await queue.enqueue(thread, input);
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'queueEnqueue', threadId: thread.id, ...input });
});

it('does not send to an older PC if the connection changes while resuming its thread', async () => {
  let finish!: (result: unknown) => void;
  const request = vi.fn().mockRejectedValueOnce(unsupported)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const queue = new QueueConnection(request);
  await queue.read();
  const sending = queue.enqueue(thread, input);
  queue.reset(); finish({ thread });
  await expect(sending).rejects.toThrow();
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'send' }));
});
