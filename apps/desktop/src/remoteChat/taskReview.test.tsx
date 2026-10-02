// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTaskReview } from '../../../../shared/remote-chat/useTaskReview';
import { useTaskReviewContext } from '../../../../shared/remote-chat/TaskReviewContext';
import type { ReviewSnapshot } from '../../../../shared/remote-chat/taskReview';
import { changedFiles } from '../../../../shared/chat/diff';

vi.mock('../../../../shared/remote-chat/TaskReviewContext', () => ({ useTaskReviewContext: vi.fn() }));
const snapshot: ReviewSnapshot = { revision: { id: 'v1', head: 'head', branch: 'feature', dirty: true },
  checks: [], commands: [{ kind: 'test', command: 'npm run test' }] };
const context = { threadId: 'thread', cwd: '/repo', active: true, ready: true, send: vi.fn(async () => true),
  client: { snapshot: vi.fn(async () => snapshot), run: vi.fn(), pullRequest: vi.fn(),
    createPullRequest: vi.fn(), restore: vi.fn() } };
const turn = { id: 'turn', status: 'completed', items: [] };
let root: Root;
let model: ReturnType<typeof useTaskReview>;
function Fixture() { model = useTaskReview(turn); return null; }

beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(useTaskReviewContext).mockReturnValue(context);
  context.client.snapshot.mockResolvedValue(snapshot); context.send.mockResolvedValue(true);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('does not overlap polling and ignores a late snapshot after disconnect', async () => {
  let finish!: (value: ReviewSnapshot) => void;
  context.client.snapshot.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = model.refresh(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(context.client.snapshot).toHaveBeenCalledTimes(2);
  vi.mocked(useTaskReviewContext).mockReturnValue({ ...context, ready: false });
  await act(async () => root.render(<Fixture />));
  await act(async () => { finish(snapshot); await pending; });
  expect(model.snapshot).toBeNull();
  expect(model.enabled).toBe(false);
});

it('drops an unverifiable snapshot instead of presenting old checks as current', async () => {
  context.client.snapshot.mockRejectedValue(new Error('电脑已断线'));
  await act(async () => { await model.refresh(); });
  expect(model.snapshot).toBeNull();
  expect(model.error).toBe('电脑已断线');
});

it('loads immediately after StrictMode replays effects without overlapping requests', async () => {
  context.client.snapshot.mockClear();
  await act(async () => root.render(<React.StrictMode><Fixture /></React.StrictMode>));
  expect(model.snapshot).toEqual(snapshot);
  expect(model.loading).toBe(false);
  expect(context.client.snapshot).toHaveBeenCalledTimes(2);
});

it('ignores a snapshot started before a check was launched', async () => {
  let finish!: (value: ReviewSnapshot) => void;
  context.client.snapshot.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = model.refresh(); });
  const running = { kind: 'test' as const, command: 'npm run test', status: 'running' as const,
    revision: 'v1', startedAt: 1, output: '' };
  context.client.run.mockResolvedValue(running);
  context.client.snapshot.mockResolvedValue({ ...snapshot, checks: [running] });
  await act(async () => { await model.run('test'); finish(snapshot); await pending; });
  expect(model.snapshot?.checks).toEqual([running]);
});

it('keeps feedback after an uncertain send and prevents duplicate submissions', async () => {
  const file = changedFiles([{ path: 'app.ts', diff: '@@ -1 +1 @@\n-old\n+new\n', kind: { type: 'update' } }])[0];
  const line = file.lines.find(row => row.kind === 'add')!;
  await act(async () => { model.selectLine(file, line); model.setFeedback('Handle empty input'); });
  let finish!: (value: boolean) => void;
  context.send.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = model.sendComment(); await model.sendComment(); });
  expect(context.send).toHaveBeenCalledTimes(1);
  await act(async () => { finish(false); await pending; });
  expect(model.feedback).toBe('Handle empty input');
  expect(model.comment?.file.path).toBe('app.ts');
  expect(model.error).toContain('尚未确认');
});
