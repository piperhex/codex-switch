import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitChange, GitChanges, GitClient, GitCommit, GitDiff } from './gitTypes';

const errorText = (error: unknown) => typeof error === 'string' ? error
  : error instanceof Error ? error.message : '无法读取 Git 信息，请稍后重试。';
export type GitDetail = { path: string; commit?: string; title: string };

export function useRemoteGit({ client, cwd, active, connected }: {
  client: GitClient; cwd: string; active: boolean; connected: boolean;
}) {
  const scope = useMemo(() => ({}), [client, cwd]);
  const current = useRef(scope);
  current.current = scope;
  const pending = useRef(new Set<object>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [detail, setDetail] = useState<GitDetail | null>(null);
  const load = useCallback(async () => {
    const [next, history] = await Promise.all([client.changes(cwd), client.history(cwd, 0)]);
    if (current.current !== scope) return;
    setChanges(next); setCommits(history.commits); setHasMore(history.hasMore);
    setSelected(previous => Object.fromEntries(next.files.filter(file =>
      !file.conflict && previous[file.path] === file.version).map(file => [file.path, file.version])));
  }, [client, cwd, scope]);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (pending.current.has(scope) || !connected || !cwd || !active) return;
    pending.current.add(scope); setBusy(true); setError('');
    try { await action(); }
    catch (error) { if (current.current === scope) setError(errorText(error)); }
    finally { pending.current.delete(scope); if (current.current === scope) setBusy(false); }
  }, [connected, cwd, active, scope]);
  const refresh = useCallback(() => run(load), [run, load]);
  useEffect(() => {
    current.current = scope;
    setChanges(null); setCommits([]); setSelected({}); setMessage(''); setDetail(null); setNotice(''); setError('');
    return () => { current.current = {}; };
  }, [scope]);
  useEffect(() => { void refresh(); }, [refresh]);
  const toggle = (file: GitChange) => {
    if (busy || file.conflict) return;
    setSelected(previous => {
      const next = { ...previous };
      if (next[file.path]) delete next[file.path]; else next[file.path] = file.version;
      return next;
    });
  };
  const selectAll = () => setSelected(previous => {
    const files = changes?.files.filter(file => !file.conflict) ?? [];
    return files.every(file => previous[file.path]) ? {}
      : Object.fromEntries(files.map(file => [file.path, file.version]));
  });
  const commit = () => run(async () => {
    if (!changes || changes.files.some(file => file.conflict)
      || !message.trim() || !Object.keys(selected).length) return;
    const result = await client.commit({ cwd, head: changes.head, message: message.trim(),
      files: Object.entries(selected).map(([path, version]) => ({ path, version })) });
    if (current.current !== scope) return;
    setSelected({}); setMessage(''); setDetail(null); setNotice(result.hash.slice(0, 8));
    await load();
  });
  const more = () => run(async () => {
    const page = await client.history(cwd, commits.length);
    if (current.current !== scope) return;
    setCommits(previous => [...previous,
      ...page.commits.filter(commit => !previous.some(row => row.hash === commit.hash))]);
    setHasMore(page.hasMore);
  });
  return { busy, error, notice, changes, commits, hasMore, selected, message, setMessage, tab, setTab,
    detail, setDetail, refresh, toggle, selectAll, commit, more,
    canCommit: connected && !busy && !!message.trim() && Object.keys(selected).length > 0
      && !changes?.files.some(file => file.conflict) };
}

export type RemoteGit = ReturnType<typeof useRemoteGit>;

export function useGitDiff(client: GitClient, cwd: string, detail: GitDetail | null, enabled: boolean) {
  const [value, setValue] = useState<GitDiff | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setValue(null); setError('');
    if (detail && enabled) void client.diff(cwd, detail.path, detail.commit).then(value => {
      if (alive) setValue(value);
    }).catch(error => { if (alive) setError(errorText(error)); });
    return () => { alive = false; };
  }, [client, cwd, detail, enabled]);
  return { value, error };
}
