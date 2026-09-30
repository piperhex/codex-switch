import { useEffect, useMemo, useState } from 'react';
import type { CliRelease, GuiToolsClient, RemoteCliStatus } from './guiTools';

const STATUS_REFRESH_MS = 15_000;
const INSTALL_REFRESH_MS = 1000;
const EMPTY_STATUS: RemoteCliStatus = { version: null, installing: false, progress: null, error: '' };

export function useRemoteCliInstaller(client: GuiToolsClient, active: boolean) {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [release, setRelease] = useState<CliRelease | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [revision, setRevision] = useState(0);
  const scope = useMemo(() => ({ active: false, epoch: 0, mutation: 0, readMutation: 0, busy: false,
    reading: undefined as Promise<RemoteCliStatus> | undefined }), [client]);
  useEffect(() => {
    setStatus(EMPTY_STATUS); setRelease(null); setError(''); setReadError('');
  }, [client]);
  useEffect(() => {
    scope.active = active; setChecked(false); setChecking(false);
    return () => { scope.active = false; scope.epoch += 1; };
  }, [scope, active]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      let delay = STATUS_REFRESH_MS;
      // A status requested before installation must not overwrite the new download state.
      if (!scope.reading) scope.readMutation = scope.mutation;
      const revision = scope.readMutation;
      try {
        const pending = scope.reading ??= client.status();
        const next = await pending.finally(() => { if (scope.reading === pending) scope.reading = undefined; });
        if (cancelled) return;
        if (revision !== scope.mutation) { delay = INSTALL_REFRESH_MS; return; }
        setStatus(next); setReadError('');
        if (next.installing) delay = INSTALL_REFRESH_MS;
      } catch {
        if (!cancelled && revision === scope.mutation) {
          setReadError('无法读取远程 Codex 版本，请确认远程电脑已更新 Remote AI。');
        }
      }
      finally {
        if (!cancelled) { setChecked(true); timer = setTimeout(() => { void refresh(); }, delay); }
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, active, revision, scope]);

  const check = async () => {
    if (!scope.active || scope.busy || status.installing) return;
    const epoch = scope.epoch;
    const current = () => scope.active && scope.epoch === epoch;
    scope.busy = true; setChecking(true); setError('');
    try { const next = await client.release(); if (current()) setRelease(next); }
    catch { if (current()) setError('未能检查远程 Codex 版本，请稍后重试。'); }
    finally {
      scope.busy = false;
      if (current()) { setChecking(false); setRevision(value => value + 1); }
    }
  };
  const install = async () => {
    if (!scope.active || !checked || readError || !release || release.version === status.version
      || scope.busy || status.installing) return;
    const epoch = scope.epoch;
    const current = () => scope.active && scope.epoch === epoch;
    scope.mutation += 1;
    scope.busy = true; setStatus(value => ({ ...value, installing: true, progress: null })); setError('');
    try { const next = await client.install(release.version); if (current()) setStatus(next); }
    catch (reason) {
      if (current()) {
        setStatus(value => ({ ...value, installing: false }));
        setError(reason instanceof Error ? reason.message : '远程 Codex 更新未完成，请稍后重试。');
      }
    } finally {
      scope.busy = false;
      if (current()) setRevision(value => value + 1);
    }
  };
  return { ...status, error: error || status.error || readError, release, checking, checked,
    readable: checked && !readError, check, install };
}
