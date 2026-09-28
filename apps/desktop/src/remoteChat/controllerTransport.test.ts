import { afterEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('finishes the original GUI initialization across path changes and retains loaded chat state', async () => {
  let events!: ConnectionEvents;
  let initialize!: (value: unknown) => void;
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'connect') return new Promise((resolve) => { initialize = resolve; });
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController((callbacks) => {
    events = callbacks;
    return { request: <T>(method: string) => request(method) as Promise<T>,
      start: () => { events.mode('relay'); events.ready(); }, stop: () => events.mode('offline') };
  });
  controller.start();
  events.mode('direct');
  events.mode('connecting');
  events.mode('relay');
  initialize([]);
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  const before = request.mock.calls.length;
  events.mode('direct');
  expect(controller.snapshot().ready).toBe(true);
  expect(request).toHaveBeenCalledTimes(before);
  expect(request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(1);
  controller.stop();
});

it('retries GUI synchronization after its request fails during an outage and the same session recovers', async () => {
  vi.useFakeTimers();
  let events!: ConnectionEvents;
  let failInitialization!: (error: Error) => void;
  let attempts = 0;
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'connect' && ++attempts === 1) {
      return new Promise((_resolve, reject) => { failInitialization = reject; });
    }
    if (method === 'connect') return [];
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController(callbacks => {
    events = callbacks;
    return { request: <T>(method: string) => request(method) as Promise<T>,
      start: () => { events.mode('relay'); events.ready(); }, stop: () => events.mode('offline') };
  });
  try {
    controller.start();
    events.mode('connecting');
    failInitialization(new Error('Timed out during network outage'));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.snapshot().ready).toBe(false);
    // Transport v2 resumes without firing ready a second time.
    events.mode('relay');
    events.mode('direct');
    await vi.advanceTimersByTimeAsync(3000);
    expect(request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(2);
    expect(controller.snapshot().ready).toBe(true);
    expect(controller.snapshot().error).toBe('');
  } finally { controller.stop(); }
});
