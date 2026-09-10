import { expect, it } from 'vitest';
import { chatAccountKey, completedChatTarget, notificationId, parseChatNotification } from './notificationTarget';

const account = chatAccountKey({ baseUrl: 'https://example.test', email: 'user@example.test' });
const target = { kind: 'chat-completed' as const, account, deviceId: 'pc', threadId: 'chat', turnId: 'turn' };

it('scopes notifications to the server and signed-in account without storing credentials', () => {
  expect(account).toBe(chatAccountKey({ baseUrl: 'https://EXAMPLE.test/', email: 'USER@example.test' }));
  expect(account).not.toBe(chatAccountKey({ baseUrl: 'https://other.test', email: 'user@example.test' }));
  expect(account).not.toBe(chatAccountKey({ baseUrl: 'https://example.test', email: 'other@example.test' }));
  expect(chatAccountKey({ baseUrl: 'https://example.test/A', email: 'user@example.test' }))
    .not.toBe(chatAccountKey({ baseUrl: 'https://example.test/a', email: 'user@example.test' }));
  expect(parseChatNotification({ ...target, accessToken: 'secret' })).toEqual(target);
});

it('notifies completed and failed turns, including chats outside the visible conversation', () => {
  for (const status of ['completed', 'failed']) {
    expect(completedChatTarget({ method: 'turn/completed', params: {
      threadId: 'chat', turn: { id: 'turn', status, items: [] },
    } }, { account, deviceId: 'pc' })).toEqual(target);
  }
  expect(completedChatTarget({ method: 'turn/completed', params: {
    threadId: 'chat', turn: { id: 'turn', status: 'interrupted', items: [] },
  } }, { account, deviceId: 'pc' })).toBeNull();
});

it('rejects malformed targets and distinguishes turns and computers', () => {
  for (const value of [null, {}, { ...target, account: '' }, { ...target, deviceId: '' },
    { ...target, threadId: 42 }, { ...target, turnId: 'x'.repeat(201) }]) {
    expect(parseChatNotification(value)).toBeNull();
  }
  expect(notificationId(target)).toBe(notificationId({ ...target }));
  expect(notificationId(target)).not.toBe(notificationId({ ...target, turnId: 'another' }));
  expect(notificationId(target)).not.toBe(notificationId({ ...target, deviceId: 'another' }));
});
