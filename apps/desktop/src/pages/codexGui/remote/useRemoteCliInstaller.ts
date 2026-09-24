import { useEffect, useRef, useState } from 'react';
import type { CliRelease, GuiToolsClient, RemoteCliStatus } from '../../../../../../shared/remote-chat/guiTools';

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
  const busy = useRef(false);
  const reading = useRef<Promise<RemoteCliStatus>>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      let delay = STATUS_REFRESH_MS;
      try {
        const pending = reading.current ??= client.status();
        const next = await pending.finally(() => { if (reading.current === pending) reading.current = undefined; });
        if (cancelled) return;
        setStatus(next); setReadError('');
        if (next.installing) delay = INSTALL_REFRESH_MS;
      } catch { if (!cancelled) setReadError('无法读取远程 Codex 版本，请确认远程电脑已更新 Codex Switch。'); }
      finally {
        if (!cancelled) { setChecked(true); timer = setTimeout(() => { void refresh(); }, delay); }
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, active, revision]);

  const check = async () => {
    if (!active || busy.current) return;
    busy.current = true; setChecking(true); setError('');
    try { const next = await client.release(); if (mounted.current) setRelease(next); }
    catch { if (mounted.current) setError('未能检查远程 Codex 版本，请稍后重试。'); }
    finally { busy.current = false; if (mounted.current) setChecking(false); }
  };
  const install = async () => {
    if (!active || !release || busy.current || status.installing) return;
    busy.current = true; setStatus(value => ({ ...value, installing: true, progress: null })); setError('');
    try { const next = await client.install(release.version); if (mounted.current) setStatus(next); }
    catch (reason) {
      if (mounted.current) {
        setStatus(value => ({ ...value, installing: false }));
        setError(reason instanceof Error ? reason.message : '远程 Codex 更新未完成，请稍后重试。');
      }
    } finally {
      busy.current = false;
      if (mounted.current) setRevision(value => value + 1);
    }
  };
  return { ...status, error: error || status.error || readError, release, checking, checked, check, install };
}
