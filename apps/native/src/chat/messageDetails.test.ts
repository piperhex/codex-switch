import { expect, it } from 'vitest';
import { messageContent, messageSections, turnFiles } from '../../../../shared/chat/messageDetails';

it('keeps reasoning, output, arguments, falsy results and errors together without duplicate bodies', () => {
  const sections = messageSections({ id: 'tool', type: 'mcpToolCall', summary: ['summary'], text: 'details',
    aggregatedOutput: 'output', output: 'output', arguments: { path: 'a.ts' }, result: false,
    error: { message: 'failed' }, exitCode: 0 });
  expect(sections.map((section) => section.text)).toEqual([
    'summary', 'details', 'output', '{\n  "path": "a.ts"\n}', 'false', '{\n  "message": "failed"\n}', '0',
  ]);
});

it('retains full messages and multi-file changes, preferring a net diff when present', () => {
  const text = '全文'.repeat(20_000);
  expect(messageContent({ id: 'user', type: 'userMessage', content: [{ type: 'text', text }] })).toBe(text);
  const turn = { id: 'turn', status: 'completed', items: [{ id: 'edit', type: 'fileChange', changes: [
    { path: 'a.ts', kind: { type: 'add' }, diff: 'first\nsecond\n' },
    { path: 'old.ts', kind: { type: 'delete' }, diff: 'removed\n' },
  ] }] };
  expect(turnFiles(turn).map(({ path, added, removed }) => ({ path, added, removed }))).toEqual([
    { path: 'a.ts', added: 2, removed: 0 }, { path: 'old.ts', added: 0, removed: 1 },
  ]);
  expect(turnFiles({ ...turn, diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n' }))
    .toMatchObject([{ path: 'a.ts', added: 1, removed: 1 }]);
});
