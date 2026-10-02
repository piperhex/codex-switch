import { useCallback, useEffect, useRef, useState } from 'react';
import { useTaskReviewContext } from './TaskReviewContext';
import type { Turn } from './client/types';
import { reviewComment, type CheckKind, type RestorePreview, type ReviewPullRequest,
  type ReviewSnapshot } from './taskReview';
import type { DiffFile, DiffLine } from '../chat/diff';

const REFRESH_MS = 5_000;
const message = (error: unknown) => typeof error === 'string' ? error
  : error instanceof Error ? error.message : '操作未完成，请稍后重试。';
export interface CommentTarget { file: DiffFile; line: DiffLine }

export function useTaskReview(turn: Turn) {
  const context = useTaskReviewContext();
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [error, setError] = useState('');
  const [snapshotError, setSnapshotError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pullRequest, setPullRequest] = useState<ReviewPullRequest | null>(null);
  const [prLoaded, setPrLoaded] = useState(false);
  const [prError, setPrError] = useState('');
  const [restore, setRestore] = useState<RestorePreview | null>(null);
  const [restored, setRestored] = useState(false);
  const [comment, setComment] = useState<CommentTarget | null>(null);
  const [feedback, setFeedback] = useState('');
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const active = useRef(false);
  const latestRefresh = useRef<(() => Promise<void>) | undefined>(undefined);
  const client = context?.client;
  const cwd = context?.cwd ?? '';
  const enabled = Boolean(context?.active && context.ready && cwd);

  const refresh = useCallback(async () => {
    if (!enabled || !client || inFlight.current || mutation.current) return;
    const token = generation.current;
    inFlight.current = true; setLoading(true);
    try {
      const value = await client.snapshot(cwd);
      if (token === generation.current) { setSnapshot(value); setSnapshotError(''); }
    } catch (cause) {
      if (token === generation.current) { setSnapshot(null); setSnapshotError(message(cause)); }
    }
    finally {
      inFlight.current = false;
      if (token === generation.current) setLoading(false);
      else if (active.current) void latestRefresh.current?.();
    }
  }, [enabled, client, cwd]);
  latestRefresh.current = refresh;

  useEffect(() => {
    generation.current += 1;
    active.current = enabled;
    setSnapshot(null); setRestore(null); setPullRequest(null); setPrLoaded(false);
    setPrError(''); setError(''); setSnapshotError(''); setLoading(false);
    void refresh();
    if (!enabled) return;
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { active.current = false; generation.current += 1; clearInterval(timer); };
  }, [refresh, enabled, turn.id]);

  const act = async (action: () => Promise<void>) => {
    if (!enabled || mutation.current) return;
    generation.current += 1; setLoading(false);
    mutation.current = true; setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(message(cause)); }
    finally { mutation.current = false; setBusy(false); if (active.current) void latestRefresh.current?.(); }
  };
  const run = (kind: CheckKind) => act(async () => {
    if (!snapshot || !client) return;
    const check = await client.run(cwd, kind, snapshot.revision.id);
    setSnapshot(current => current && { ...current, checks: [...current.checks.filter(row => row.kind !== kind), check] });
  });
  const loadPr = () => act(async () => {
    try { setPullRequest(await client!.pullRequest(cwd)); setPrLoaded(true); setPrError(''); }
    catch (cause) { setPrError(message(cause)); }
  });
  const createPr = (input: { title: string; body: string; base: string }) => act(async () => {
    if (!snapshot || !client) return;
    setPullRequest(await client.createPullRequest({ ...input, cwd, revision: snapshot.revision.id }));
    setPrLoaded(true); setPrError('');
  });
  const previewRestore = () => act(async () => {
    setRestore(null);
    const value = await client!.restore({ threadId: context!.threadId, turnId: turn.id, preview: true });
    setRestored(value.undone); setRestore(value.preview ?? null);
  });
  const confirmRestore = () => act(async () => {
    if (!restore || restore.conflict) return;
    const value = await client!.restore({ threadId: context!.threadId, turnId: turn.id, expectedVersion: restore.version });
    setRestored(value.undone); setRestore(null); await refresh();
  });
  const sendComment = () => act(async () => {
    if (!comment || !context) return;
    const text = reviewComment({ turn, ...comment, text: feedback });
    if (!text) return;
    if (!await context.send(text)) throw new Error('尚未确认意见已发送，请先检查原会话。');
    setComment(null); setFeedback(''); setSent(true);
  });
  const selectLine = (file: DiffFile, line: DiffLine) => {
    setComment({ file, line }); setFeedback(''); setSent(false);
  };
  return { snapshot, error: error || snapshotError, busy, loading, enabled, refresh, run,
    pullRequest, prLoaded, prError, loadPr, createPr,
    restore, restored, previewRestore, confirmRestore, comment, feedback, setFeedback, sendComment, sent,
    selectLine, closeComment: () => setComment(null),
    running: snapshot?.checks.some(check => check.status === 'running') ?? false };
}

export type TaskReviewModel = ReturnType<typeof useTaskReview>;
