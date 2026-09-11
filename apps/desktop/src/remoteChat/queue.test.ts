// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from '../pages/codexGui/controller';
import { guiApi } from '../pages/codexGui/api';
import type { GuiEvent, Thread } from '../pages/codexGui/types';
import { RemoteQueue } from './queue';
import { AcknowledgedMessages } from './acknowledgedMessages';
import { updateThread } from '../../../../shared/remote-chat/client/events';

vi.mock('../pages/codexGui/api', () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(),
} }));
let controller: GuiController;
let queue: RemoteQueue;
let receive: (event: GuiEvent) => void;
let thread: Thread;
const input = { operation: 'queueEnqueue', threadId: 'phone', text: 'next task', images: [],
  model: 'phone-model', effort: 'high', access: 'read-only' };

beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear();
  thread = { id: 'phone', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'live', status: 'inProgress', items: [] }] };
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return () => {}; });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === 'list' || request.operation === 'models') return { data: [], nextCursor: null };
    if (request.operation === 'sendBatch') return { turn: { id: 'next', status: 'inProgress', items: [] } };
    return { thread };
  });
  controller = new GuiController(); queue = new RemoteQueue(() => controller);
  await controller.connect();
});
afterEach(() => controller.dispose());

it('publishes confirmed supplements before history catches up and restores them after reconnecting', async () => {
  const acknowledgements = new AcknowledgedMessages(() => controller);
  let mobile = structuredClone(thread);
  const events = vi.fn((event: GuiEvent) => { mobile = updateThread(mobile, event); });
  const unsubscribe = acknowledgements.subscribe(events);
  await queue.request(input);
  const id = queue.read().threads.phone[0].id;
  expect(events).not.toHaveBeenCalled();
  await queue.request({ operation: 'queueSendNow', threadId: 'phone', id });
  expect(events).toHaveBeenCalledTimes(1);
  expect(mobile.turns![0].items).toMatchObject([{ localEcho: true, content: [{ text: 'next task' }] }]);
  expect(thread.turns![0].items).toEqual([]);
  expect(acknowledgements.merge(thread).turns![0].items).toEqual(mobile.turns![0].items);
  const serverItem = { id: 'server-message', type: 'userMessage', content: [{ type: 'text', text: 'next task' }] };
  const event = { method: 'item/completed', params: { threadId: 'phone', turnId: 'live', item: serverItem } };
  receive(event); mobile = updateThread(mobile, event);
  expect(mobile.turns![0].items).toEqual([serverItem]);
  unsubscribe();
});

it('never publishes an acknowledgement for a failed send', async () => {
  const events = vi.fn();
  const unsubscribe = new AcknowledgedMessages(() => controller).subscribe(events);
  await queue.request(input);
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('send failed'));
  await queue.request({ operation: 'queueSendNow', threadId: 'phone', id: queue.read().threads.phone[0].id });
  expect(events).not.toHaveBeenCalled();
  unsubscribe();
});

it('queues on the PC without steering or changing its selection, then sends after completion', async () => {
  const updates = vi.fn(); const unsubscribe = queue.subscribe(updates);
  const snapshot = await queue.request(input);
  expect(controller.getSnapshot().selected).toBeNull();
  expect(snapshot.threads.phone).toMatchObject([{ text: 'next task', busy: false }]);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'steer' }));
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'sendBatch' }));
  // The phone can leave: only PC lifecycle events are needed to drain the queue.
  unsubscribe();
  thread.turns![0].status = 'completed';
  receive({ method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns![0] } });
  await vi.waitFor(() => expect(queue.read().threads.phone).toBeUndefined());
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'sendBatch', threadId: 'phone',
    model: 'phone-model', effort: 'high', access: 'read-only', messages: [{ text: 'next task', images: [], skills: [] }] }));
  expect(updates).toHaveBeenCalled();
});

it('sends only the chosen message now, retaining other PC and phone messages', async () => {
  await queue.request(input);
  controller.queue.enqueue('phone', { text: 'PC message', images: [], skills: [] });
  const id = queue.read().threads.phone[0].id;
  await Promise.all([queue.request({ operation: 'queueSendNow', threadId: 'phone', id }),
    queue.request({ operation: 'queueSendNow', threadId: 'phone', id })]);
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'steer')).toHaveLength(1);
  expect(queue.read().threads.phone).toMatchObject([{ text: 'PC message' }]);
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'steer', turnId: 'live' }));
});

it('retains failed messages for retry and never transmits image data in queue previews', async () => {
  const images = ['data:image/png;base64,aGVsbG8='];
  await queue.request({ ...input, images });
  const id = queue.read().threads.phone[0].id;
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('private transport failure'));
  await queue.request({ operation: 'queueSendNow', threadId: 'phone', id });
  expect(queue.read().threads.phone).toMatchObject([{ id, busy: false, imageCount: 1, error: '发送失败，请重试。' }]);
  expect(JSON.stringify(queue.read())).not.toContain(images[0]);
  await queue.request({ operation: 'queueSendNow', threadId: 'phone', id });
  expect(queue.read().threads.phone).toBeUndefined();
  expect(guiApi.request).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'steer', images }));
});

it('rejects invalid input and synchronizes PC edits and removals', async () => {
  await expect(queue.request({ ...input, images: ['file:///private'] })).rejects.toThrow();
  expect(queue.read().threads).toEqual({});
  await queue.request(input);
  const before = queue.read();
  const id = before.threads.phone[0].id;
  const draft = controller.queue.take('phone', id);
  expect(draft?.text).toBe('next task');
  expect(queue.read().revision).toBeGreaterThan(before.revision);
  expect(queue.read().threads.phone).toBeUndefined();
});

it('preserves structured skills through queued sends and rejects malformed references', async () => {
  const skills = [{ name: 'review', path: 'C:/skills/review/SKILL.md' }];
  await expect(queue.request({ ...input, skills: [{ name: 'review' }] })).rejects.toThrow();
  expect(queue.read().threads).toEqual({});
  await queue.request({ ...input, skills });
  const id = queue.read().threads.phone[0].id;
  await queue.request({ operation: 'queueSendNow', threadId: 'phone', id });
  expect(guiApi.request).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'steer', skills }));
  expect(queue.read().threads.phone).toBeUndefined();
  thread.turns![0].status = 'completed';
  receive({ method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns![0] } });
  await queue.request({ ...input, skills });
  await vi.waitFor(() => expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    operation: 'sendBatch', messages: [expect.objectContaining({ skills })],
  })));
});

it('does not leave a message waiting when an unseen PC turn completes during its history read', async () => {
  let finishRead!: (value: unknown) => void;
  const staleThread = structuredClone(thread);
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  const enqueue = queue.request(input);
  thread.turns![0].status = 'completed';
  receive({ method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns![0] } });
  finishRead({ thread: staleThread });
  await enqueue;
  await vi.waitFor(() => expect(queue.read().threads.phone).toBeUndefined());
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'sendBatch' }));
});

it('preserves phone bytes, PC files and plugins for attachment-only queued and immediate sends', async () => {
  const attachments = [
    { kind: 'file', name: 'note.txt', path: '', data: 'aGVsbG8=' },
    { kind: 'file', name: 'photo.png', path: 'C:/project/photo.png' },
    { kind: 'plugin', name: 'GitHub', path: 'plugin://github@openai' },
  ];
  await queue.request({ ...input, text: '', attachments });
  const id = queue.read().threads.phone[0].id;
  expect(queue.read().threads.phone[0]).toMatchObject({ text: 'note.txt、photo.png、GitHub', attachmentCount: 3 });
  expect(JSON.stringify(queue.read())).not.toContain(attachments[0].data);
  expect(JSON.stringify(queue.read())).not.toContain(attachments[1].path);
  await queue.request({ operation: 'queueSendNow', threadId: 'phone', id });
  expect(guiApi.request).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'steer', attachments }));
  thread.turns![0].status = 'completed';
  receive({ method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns![0] } });
  await queue.request({ ...input, text: '', attachments });
  await vi.waitFor(() => expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    operation: 'sendBatch', messages: [expect.objectContaining({ text: '', attachments })],
  })));
});
