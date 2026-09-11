import { expect, it } from 'vitest';
import { acknowledgedEvents } from '../../../../shared/chat/acknowledgedMessages';
import { updateThread } from '../../../../shared/remote-chat/client/events';
import { mergeHistory } from '../../../../shared/remote-chat/client/history';
import type { Item, Thread } from './types';

const user = (id: string, localEcho = false): Item => ({ id, type: 'userMessage', localEcho,
  content: [{ type: 'text', text: '继续' }] });
const thread = (items: Item[]): Thread => ({ id: 'chat', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'inProgress', items }] });

it('shows acknowledged supplements immediately and replaces identical messages exactly once', () => {
  let mobile = thread([user('first')]);
  const events = acknowledgedEvents(thread([user('first'), user('sent-a', true), user('sent-b', true)]));
  for (const event of [...events, ...events]) mobile = updateThread(mobile, event);
  expect(mobile.turns![0].items.map((item) => item.id)).toEqual(['first', 'sent-a', 'sent-b']);
  for (const id of ['second', 'second', 'third', 'third']) mobile = updateThread(mobile, {
    method: 'item/completed', params: { threadId: 'chat', turnId: 'turn', item: user(id) },
  });
  for (const event of events) mobile = updateThread(mobile, event);
  expect(mobile.turns![0].items.map((item) => item.id)).toEqual(['first', 'second', 'third']);
});

it('retains acknowledgements across stale reads and reconciles expanded history pages', () => {
  const live = thread([user('first'), user('sent-a', true)]);
  expect(mergeHistory(thread([user('first')]), live, live).turns![0].items.map((item) => item.id))
    .toEqual(['first', 'sent-a']);
  const older = thread([user('older'), user('first')]);
  expect(mergeHistory(older, live, live).turns![0].items.map((item) => item.id))
    .toEqual(['older', 'first', 'sent-a']);
  const saved = thread([user('older'), user('first'), user('second')]);
  expect(mergeHistory(saved, live, live).turns![0].items.map((item) => item.id))
    .toEqual(['older', 'first', 'second']);
});

it.each(['inProgress', 'completed'])('does not resurrect an old acknowledgement during a %s history read', (status) => {
  const before = thread([user('first'), user('sent-a', true)]);
  const live = thread([user('first'), user('second')]);
  before.turns![0].status = status;
  live.turns![0].status = status;
  expect(mergeHistory(before, live, live).turns![0].items.map((item) => item.id)).toEqual(['first', 'second']);
});
