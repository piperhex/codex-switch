import { expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { SIDEBAR_EVENT, type SidebarSnapshot } from '../../../../shared/remote-chat/sidebar';
import { historyDelta, type HistoryVersion } from '../../../../shared/remote-chat/historySync';

it('acknowledges loaded visible replies and keeps newer PC read state ahead of stale responses', async () => {
  const thread = { id: 'one', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'completed', items: [] }] };
  const sidebar: SidebarSnapshot = { revision: 1, threads: {}, readState: { one: { turnId: 'turn', unread: true } } };
  let events: ConnectionEvents;
  const request = vi.fn(async (method: string, body?: { operation: string; known?: HistoryVersion }) => {
    if (method === 'connect') return [];
    if (body?.operation === 'list') return { data: [thread], nextCursor: null, sidebar };
    if (body?.operation === 'syncHistory') return historyDelta(thread, body.known);
    if (body?.operation === 'threadRead') return { ...sidebar, revision: 3,
      readState: { one: { turnId: 'turn', unread: false } } };
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController((handlers) => {
    events = handlers;
    // The fake implements only the connection's public methods; no transport internals run in this test.
    return { start() { handlers.mode('relay'); handlers.ready(); }, stop() {}, request } as unknown as ChatConnection;
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  request.mockRejectedValueOnce(new Error('History unavailable'));
  await controller.select(thread);
  expect(controller.snapshot().sidebar.readState.one.unread).toBe(true);
  expect(request.mock.calls.some(([, body]) => body?.operation === 'threadRead')).toBe(false);
  controller.setViewing(false);
  await controller.select(thread);
  expect(request.mock.calls.some(([, body]) => body?.operation === 'threadRead')).toBe(false);
  controller.setViewing(true);
  await vi.waitFor(() => expect(controller.snapshot().sidebar.readState.one.unread).toBe(false));
  events!.event({ method: SIDEBAR_EVENT, params: { ...sidebar, revision: 2 } });
  expect(controller.snapshot().sidebar.readState.one.unread).toBe(false);
  controller.stop();
});
