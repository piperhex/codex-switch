import { afterEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { HISTORY_CHANGED, historyDelta, type HistoryDelta, type HistoryVersion }
  from '../../../../shared/remote-chat/historySync';
import type { Thread } from './types';
import { INITIAL_TRANSFORM, moveImage } from '../../../../shared/chat/imageTransform';

afterEach(() => vi.useRealTimers());

it('zooms around the pinch midpoint without drifting toward the first finger', () => {
  expect(moveImage({ before: INITIAL_TRANSFORM, start: [{ x: 50, y: 50 }, { x: 150, y: 50 }],
    current: [{ x: 0, y: 50 }, { x: 200, y: 50 }] })).toEqual({ ...INITIAL_TRANSFORM, scale: 2 });
});

it('repairs an update received during a pending read without overlapping requests or duplicating text', async () => {
  const remote: Thread = { id: 'chat', preview: '', cwd: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'item', type: 'agentMessage', text: 'first' }] }] };
  let events: ConnectionEvents;
  let finish: ((delta: HistoryDelta) => void) | undefined;
  let delay = false;
  let activeReads = 0;
  let maxReads = 0;
  const responses: HistoryDelta[] = [];
  let pending: HistoryDelta;
  const request = async (method: string, body?: { operation: string; known?: HistoryVersion }) => {
    if (method === 'connect') return [];
    if (body?.operation !== 'syncHistory') return { data: [], nextCursor: null };
    activeReads++;
    maxReads = Math.max(maxReads, activeReads);
    const delta = historyDelta(structuredClone(remote), body.known);
    responses.push(delta);
    if (delay) {
      pending = delta;
      await new Promise<HistoryDelta>((resolve) => { finish = resolve; });
    }
    activeReads--;
    return delta;
  };
  const controller = new ChatController((handlers) => {
    events = handlers;
    return { start() { handlers.mode('relay'); handlers.ready(); }, stop() {}, request } as unknown as ChatConnection;
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  await controller.select({ ...remote, turns: [] });
  vi.useFakeTimers();
  delay = true;
  const read = controller.refreshSelected();
  remote.turns![0].items[0].text += ' plus a missed suffix';
  remote.turns![0].status = 'completed';
  events!.event({ method: HISTORY_CHANGED, params: { threadId: remote.id } });
  await controller.refreshSelected();
  delay = false;
  finish!(pending!);
  await read;
  await vi.advanceTimersByTimeAsync(100);
  expect(controller.snapshot().selected).toEqual(remote);
  expect(maxReads).toBe(1);
  expect(JSON.stringify(responses.slice(1))).not.toContain('first');
  const before = responses.length;
  controller.back();
  await controller.select({ ...remote, turns: [] });
  expect(responses[before].turns).toEqual([]);
  controller.stop();
  expect(vi.getTimerCount()).toBe(0);
});
