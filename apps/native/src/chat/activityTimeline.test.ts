import { expect, it } from 'vitest';
import { activityTimeline, findActivityEntry, latestActivity } from './activityTimeline';
import { conversationEntries } from './turnPresentation';
import type { Item, Turn } from './types';

const command = (id: string, status = 'completed'): Item => ({ id, type: 'commandExecution', status,
  command: `echo ${id}`, aggregatedOutput: `output-${id}` });
const commentary = (id: string): Item => ({ id, type: 'agentMessage', phase: 'commentary', text: id });
const turn = (items: Item[], status = 'inProgress'): Turn => ({ id: 'turn', status, items });

it('shows one running activity between explanations instead of all consecutive tools', () => {
  const entries = activityTimeline(conversationEntries([turn([commentary('before'), command('first'),
    { id: 'search', type: 'webSearch', query: 'docs', status: 'completed' }, command('running', 'inProgress'),
    { id: 'edit', type: 'fileChange', status: 'completed' }, commentary('after')])]));
  expect(entries.map(entry => entry.kind)).toEqual(['work', 'process', 'activities', 'process']);
  expect(entries[1]).toMatchObject({ item: { id: 'before' } });
  expect(entries[3]).toMatchObject({ item: { id: 'after' } });
  const group = entries[2];
  if (group.kind !== 'activities') throw new Error('Missing grouped tools');
  expect(group.items.map(item => item.id)).toEqual(['first', 'search', 'running', 'edit']);
  expect(latestActivity(group.items)?.id).toBe('running');
});

it('prefers the latest running operation and falls back to the final result', () => {
  expect(latestActivity([command('one', 'inProgress'), command('two', 'inProgress'), command('three')])?.id)
    .toBe('two');
  expect(latestActivity([command('one'), command('two'), command('three', 'failed')]))
    .toMatchObject({ id: 'three', status: 'failed' });
});

it('keeps reasoning, user steering, final answers and single activities in place', () => {
  const entries = activityTimeline(conversationEntries([turn([
    command('one'), command('two'), { id: 'reason', type: 'reasoning', summary: ['Check'] },
    command('three'), command('four'), { id: 'steer', type: 'userMessage', text: 'Continue' },
    command('single'), { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Done' },
  ])]));
  expect(entries.map(entry => entry.kind)).toEqual([
    'work', 'activities', 'process', 'activities', 'message', 'work', 'process', 'message',
  ]);
  expect(entries.filter(entry => 'item' in entry).map(entry => entry.item.id))
    .toEqual(['reason', 'steer', 'single', 'answer']);
  expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
});

it('keeps all 65 operations in one drawer and preserves its ID as more operations arrive', () => {
  const items = Array.from({ length: 65 }, (_, index) => command(`tool-${index}`));
  const before = activityTimeline(conversationEntries([turn(items.slice(0, 2))]));
  const source = conversationEntries([turn(items)]);
  const after = activityTimeline(source);
  expect(after.map(entry => entry.kind)).toEqual(['work', 'activities']);
  expect(after[1].id).toBe(before[1].id);
  expect(findActivityEntry(source, before[1].id)?.items).toEqual(items);
});

it.each(['completed', 'interrupted', 'failed', 'cached'])('keeps an open drawer addressable after %s', status => {
  const live = turn([command('one'), command('two', 'inProgress')]);
  const groupId = activityTimeline(conversationEntries([live]))[1].id;
  const completed = conversationEntries([{ ...live, status, items: [command('one'), command('two')] }]);
  expect(findActivityEntry(completed, groupId)).toMatchObject({ turn: { status },
    items: [{ id: 'one' }, { id: 'two', status: 'completed' }] });
});

it('resolves the same open drawer after older history extends the group', () => {
  const live = turn([command('one'), command('two')]);
  const groupId = activityTimeline(conversationEntries([live]))[1].id;
  const earlier = conversationEntries([{ ...live, items: [command('older'), ...live.items] }]);
  expect(findActivityEntry(earlier, groupId)?.items.map(item => item.id)).toEqual(['older', 'one', 'two']);
  expect(findActivityEntry(earlier, 'other-turn:activities:one')).toBeUndefined();
});

it('reuses unchanged rows and keeps tool groups from different turns separate', () => {
  const history = turn([command('one'), command('two')]);
  const live = { ...turn([command('three'), command('four')]), id: 'live' };
  const before = activityTimeline(conversationEntries([history, live]));
  const after = activityTimeline(conversationEntries([history, { ...live, items: [...live.items, command('five')] }]));
  expect(after[1]).toBe(before[1]);
  expect(after[3]).not.toBe(before[3]);
  expect(after.filter(entry => entry.kind === 'activities').map(entry => entry.turn.id)).toEqual(['turn', 'live']);
});
