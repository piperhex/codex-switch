import { expect, it, vi } from 'vitest';
import { checkStatus, createReviewClient, resultSummary, reviewComment,
  type ReviewCheck, type ReviewRevision } from '../../../../shared/remote-chat/taskReview';
import { changedFiles } from '../../../../shared/chat/diff';

const revision: ReviewRevision = { id: 'current', head: 'head', branch: 'feature', dirty: true };
const check: ReviewCheck = { kind: 'test', command: 'npm run test', revision: 'current',
  finishedRevision: 'current', status: 'passed', startedAt: 1, exitCode: 0, output: 'ok' };

it('keeps unrun, failed and interrupted checks distinct and expires results when content changes', () => {
  expect(checkStatus(undefined, revision)).toBe('notRun');
  expect(checkStatus(check, revision)).toBe('passed');
  expect(checkStatus({ ...check, status: 'failed', exitCode: 1 }, revision)).toBe('failed');
  expect(checkStatus({ ...check, status: 'interrupted' }, revision)).toBe('interrupted');
  expect(checkStatus(check, { ...revision, id: 'edited' })).toBe('stale');
  expect(checkStatus({ ...check, finishedRevision: 'edited' }, revision)).toBe('stale');
  expect(checkStatus({ ...check, status: 'running', finishedRevision: null }, revision)).toBe('running');
});

it('anchors comments to the original turn and correct side of renamed files', () => {
  const file = changedFiles([{ path: 'before.ts', kind: { type: 'update', movePath: 'after.ts' },
    diff: '@@ -3 +4 @@\n-old\n+new\n' }])[0];
  const turn = { id: 'original-turn', status: 'completed', items: [] };
  const removed = file.lines.find(line => line.kind === 'remove')!;
  const added = file.lines.find(line => line.kind === 'add')!;
  expect(reviewComment({ turn, file, line: removed, text: '解释这行' })).toContain('文件：before.ts\n位置：修改前第 3 行');
  const prompt = reviewComment({ turn, file, line: added, text: '修复边界条件' });
  expect(prompt).toContain('原任务：original-turn');
  expect(prompt).toContain('文件：after.ts\n位置：修改后第 4 行');
  expect(prompt).toContain('new\n\n验收意见：\n修复边界条件');
  expect(reviewComment({ turn, file, line: added, text: '  ' })).toBe('');
});

it('sends only the selected check and requires the reviewed version for a restore', async () => {
  const request = vi.fn(async <T,>(_body: object): Promise<T> => ({} as T));
  const client = createReviewClient(async <T,>(body: object) => await request(body) as T);
  await client.run('/repo', 'lint', 'reviewed-code');
  expect(request).toHaveBeenLastCalledWith({ operation: 'guiTaskReview', action: 'run',
    cwd: '/repo', check: 'lint', revision: 'reviewed-code' });
  await client.restore({ threadId: 'thread', turnId: 'turn', expectedVersion: 'previewed-files' });
  expect(request).toHaveBeenLastCalledWith({ operation: 'guiTaskRestore', threadId: 'thread',
    turnId: 'turn', expectedVersion: 'previewed-files' });
});

it('summarizes the final reply without treating its test claims as check receipts', () => {
  const turn = { id: 'turn', status: 'completed', items: [
    { id: 'commentary', type: 'agentMessage', phase: 'commentary' as const, text: 'still working' },
    { id: 'final', type: 'agentMessage', phase: 'final_answer' as const, text: '所有测试已通过' },
  ] };
  expect(resultSummary(turn)).toBe('所有测试已通过');
  expect(checkStatus(undefined, revision)).toBe('notRun');
});

it('keeps summary cards readable without link syntax or fenced code', () => {
  const turn = { id: 'turn', status: 'completed', items: [
    { id: 'final', type: 'agentMessage', text: '## 结果\n已修改 **[note_file.ts](src/note_file.ts:2)**。\n```ts\ncode();\n```' },
  ] };
  expect(resultSummary(turn)).toBe('结果 已修改 note_file.ts。');
});
