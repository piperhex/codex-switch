import { describe, expect, it } from 'vitest';
import { applyChatEvent } from './events';
import { mergeHistory } from './history';
import { initialChatState, type Thread } from './types';

const thread: Thread = { id: 'chat', preview: 'test', cwd: 'project', updatedAt: 1,
  turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'item', type: 'agentMessage', text: 'hello' }] }] };

describe('mobile conversation synchronization', () => {
  it('streams deltas once and preserves content when completion notifications contain no items', () => {
    let state = { ...initialChatState(), selected: thread };
    state = applyChatEvent(state, { method: 'item/agentMessage/delta',
      params: { threadId: 'chat', turnId: 'turn', itemId: 'item', delta: ' world' } }) as typeof state;
    state = applyChatEvent(state, { method: 'turn/completed',
      params: { threadId: 'chat', turn: { id: 'turn', status: 'completed', items: [] } } }) as typeof state;
    expect(state.selected.turns?.[0].items[0].text).toBe('hello world');
    expect(state.selected.turns?.[0].status).toBe('completed');
  });

  it('does not apply a different thread event and safely accepts events before a thread is selected', () => {
    const state = { ...initialChatState(), selected: thread };
    expect(applyChatEvent(state, { method: 'turn/started',
      params: { threadId: 'another', turn: { id: 'other', status: 'inProgress', items: [] } } }).selected).toBe(thread);
    expect(applyChatEvent(initialChatState(), { method: 'account/updated', params: {} }).selected).toBeNull();
  });

  it('shows pending approvals and removes a request answered on the PC', () => {
    const requested = applyChatEvent(initialChatState(), { id: 12, method: 'item/commandExecution/requestApproval',
      params: { threadId: 'chat', turnId: 'turn', command: 'npm test' } });
    expect(requested.approvals).toHaveLength(1);
    expect(applyChatEvent(requested, { method: 'serverRequest/resolved', params: { requestId: 12 } }).approvals).toEqual([]);
  });

  it('keeps live output and completion received while a stale history snapshot was loading', () => {
    const live = applyChatEvent({ ...initialChatState(), selected: thread }, {
      method: 'item/agentMessage/delta', params: { threadId: 'chat', turnId: 'turn', itemId: 'item', delta: ' world' },
    }).selected!;
    const merged = mergeHistory(structuredClone(thread), live, thread);
    expect(merged.turns?.[0].items[0].text).toBe('hello world');
    const newer = structuredClone(thread);
    newer.turns![0].items[0].text = 'hello world, all done';
    expect(mergeHistory(newer, live, thread).turns?.[0].items[0].text).toBe('hello world, all done');
  });
});
