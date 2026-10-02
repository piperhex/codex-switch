import type { CheckKind, ReviewCheck, ReviewPullRequest, ReviewSnapshot } from '../../../shared/remote-chat/taskReview';

let version = 1;
let conflict = false;
let dirty = false;
let restored = false;
let pr: ReviewPullRequest | null = null;
const checks = new Map<CheckKind, ReviewCheck>();
const revision = () => String(version).repeat(64);
export function setDemoReview(input: { changed?: boolean; conflict?: boolean; dirty?: boolean }) {
  if (input.changed) version += 1;
  if (input.conflict !== undefined) conflict = input.conflict;
  if (input.dirty !== undefined) dirty = input.dirty;
}

export function demoTaskReview(input: Record<string, unknown>): unknown {
  if (input.operation === 'guiTaskRestore') {
    if (input.preview) return { undone: restored, preview: {
      files: ['src/app.ts'], conflict, version: revision(),
    } };
    if (conflict || input.expectedVersion !== revision()) throw new Error('Restore conflict');
    restored = true; version += 1;
    return { undone: true };
  }
  if (input.action === 'snapshot') return {
    revision: { id: revision(), head: `commit-${version}`, branch: 'feature/review', dirty },
    commands: (['build', 'lint', 'test'] as const).map(kind => ({ kind, command: `npm run ${kind}` })),
    checks: [...checks.values()],
  } satisfies ReviewSnapshot;
  if (input.action === 'run') {
    if (input.revision !== revision()) throw new Error('Stale code');
    const kind = input.check as CheckKind;
    const check: ReviewCheck = { kind, command: `npm run ${kind}`, status: 'running',
      revision: revision(), startedAt: Date.now(), output: '' };
    checks.set(kind, check);
    setTimeout(() => checks.set(kind, { ...check, status: 'passed', output: '1 test passed', exitCode: 0,
      finishedRevision: revision(), finishedAt: Date.now() }), 300);
    return check;
  }
  if (input.action === 'createPullRequest') {
    if (dirty || input.revision !== revision()) throw new Error('Stale code');
    pr = { number: 42, title: String(input.title), url: 'https://github.com/example/repo/pull/42',
      headRefOid: `commit-${version}`, state: 'OPEN',
      statusCheckRollup: [{ name: 'unit-tests', status: 'COMPLETED', conclusion: 'SUCCESS' }] };
  }
  return pr;
}
