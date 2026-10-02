import type { DiffFile, DiffLine } from '../chat/diff';
import type { Turn } from './client/types';

export type CheckKind = 'build' | 'lint' | 'test';
export interface ReviewRevision { id: string; head: string | null; branch: string | null; dirty: boolean }
export interface ReviewCheck {
  kind: CheckKind; command: string; status: 'running' | 'passed' | 'failed' | 'interrupted';
  revision: string; finishedRevision?: string | null; startedAt: number; finishedAt?: number | null;
  exitCode?: number | null; output: string;
}
export interface ReviewSnapshot {
  revision: ReviewRevision;
  commands: { kind: CheckKind; command: string }[];
  checks: ReviewCheck[];
}
export interface ReviewPullRequest {
  number: number; title: string; url: string; headRefOid: string; state: string;
  statusCheckRollup?: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
}
export interface RestorePreview { files: string[]; conflict: boolean; version: string }
export interface RestoreResult { undone: boolean; preview?: RestorePreview }
export interface ReviewClient {
  snapshot: (cwd: string) => Promise<ReviewSnapshot>;
  run: (cwd: string, check: CheckKind, revision: string) => Promise<ReviewCheck>;
  pullRequest: (cwd: string) => Promise<ReviewPullRequest | null>;
  createPullRequest: (input: { cwd: string; revision: string; title: string; body: string; base: string })
    => Promise<ReviewPullRequest | null>;
  restore: (input: { threadId: string; turnId: string; preview?: boolean; expectedVersion?: string })
    => Promise<RestoreResult>;
}

export function createReviewClient(request: <T>(body: object) => Promise<T>): ReviewClient {
  const review = <T>(body: object) => request<T>({ operation: 'guiTaskReview', ...body });
  return {
    snapshot: cwd => review({ action: 'snapshot', cwd }),
    run: (cwd, check, revision) => review({ action: 'run', cwd, check, revision }),
    pullRequest: cwd => review({ action: 'pullRequest', cwd }),
    createPullRequest: input => review({ action: 'createPullRequest', ...input }),
    restore: input => request({ operation: 'guiTaskRestore', ...input }),
  };
}

export function checkStatus(check: ReviewCheck | undefined, revision: ReviewRevision) {
  if (!check) return 'notRun';
  if (check.revision !== revision.id || (check.finishedRevision && check.finishedRevision !== check.revision)) {
    return 'stale';
  }
  return check.status;
}

/** The comment includes the historical side and source text, so a deleted line is never mistaken for a new one. */
export function reviewComment(input: { turn: Turn; file: DiffFile; line: DiffLine; text: string }) {
  const { turn, file, line } = input;
  const text = input.text.trim();
  if (!text || text.length > 8_000 || !['add', 'remove', 'context'].includes(line.kind)) return '';
  const side = line.kind === 'remove' ? '修改前' : '修改后';
  const number = line.kind === 'remove' ? line.oldLine : line.newLine;
  if (!number) return '';
  return `请根据这条验收意见继续修改，并重新验证相关改动。\n\n原任务：${turn.id}\n`
    + `文件：${line.kind === 'remove' ? file.previousPath || file.path : file.path}\n`
    + `位置：${side}第 ${number} 行\n当时的代码：\n${line.text}\n\n验收意见：\n${text}`;
}

export function resultSummary(turn: Turn) {
  const final = turn.items.filter(item => item.type === 'agentMessage' && item.phase !== 'commentary').at(-1);
  return (final?.text ?? turn.planExplanation ?? '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}\s+|[-*+]\s+|>\s*)/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim().slice(0, 280);
}
