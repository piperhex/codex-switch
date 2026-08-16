import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTotpVault, syncTotpVault } from '../api/client';
import type { AuthSession } from '../types';
import {
  loadTotpCloudSyncEnabled,
  loadTotpVault,
  saveTotpCloudSyncEnabled,
  saveTotpVault,
} from './storage';
import { createTotpEntry } from './totp';
import type {
  TotpCloudRefreshResult,
  TotpDraft,
  TotpEntry,
  TotpManagerState,
  TotpVault,
} from './types';

const EMPTY_VAULT: TotpVault = { entries: [], modifiedAt: '1970-01-01T00:00:00.000Z' };

export function useTotpVault(
  session: AuthSession | null,
  notifyError: (message: string) => void,
): TotpManagerState {
  const [vault, setVault] = useState<TotpVault>(EMPTY_VAULT);
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const vaultRef = useRef(vault);
  const sessionRef = useRef(session);
  const syncEnabledRef = useRef(false);
  const syncQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const storageQueueRef = useRef<Promise<void>>(Promise.resolve());
  sessionRef.current = session;

  const persist = useCallback((activeSession: AuthSession, snapshot: TotpVault) => {
    const operation = storageQueueRef.current
      .catch(() => undefined)
      .then(() => saveTotpVault(activeSession, snapshot));
    storageQueueRef.current = operation;
    return operation;
  }, []);

  const synchronize = useCallback((activeSession: AuthSession, snapshot: TotpVault) => {
    setSyncing(true);
    const operation = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const remote = await syncTotpVault(activeSession, snapshot);
        if (sessionRef.current !== activeSession) return;
        if (Date.parse(remote.modifiedAt) < Date.parse(vaultRef.current.modifiedAt)) return;
        vaultRef.current = remote;
        setVault(remote);
        await persist(activeSession, remote);
      })
      .finally(() => {
        if (syncQueueRef.current === operation) setSyncing(false);
      });
    syncQueueRef.current = operation;
    return operation;
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    setInitialized(false);
    setCloudSyncEnabledState(false);
    syncEnabledRef.current = false;
    if (!session) {
      vaultRef.current = EMPTY_VAULT;
      setVault(EMPTY_VAULT);
      return () => { cancelled = true; };
    }
    void Promise.all([loadTotpVault(session), loadTotpCloudSyncEnabled(session)])
      .then(([storedVault, enabled]) => {
        if (cancelled) return;
        vaultRef.current = storedVault;
        syncEnabledRef.current = enabled;
        setVault(storedVault);
        setCloudSyncEnabledState(enabled);
        setInitialized(true);
        if (enabled) {
          void synchronize(session, storedVault)
            .catch((error) => notifyError(`2FA 云同步失败：${String(error)}`));
        }
      })
      .catch(() => {
        if (!cancelled) notifyError('读取本机 2FA 密钥失败');
      });
    return () => { cancelled = true; };
  }, [notifyError, session, synchronize]);

  const commitEntries = useCallback((update: (entries: TotpEntry[]) => TotpEntry[]) => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    const next = { entries: update(vaultRef.current.entries), modifiedAt: new Date().toISOString() };
    vaultRef.current = next;
    setVault(next);
    void persist(activeSession, next).catch(() => notifyError('保存 2FA 密钥失败'));
    if (syncEnabledRef.current) {
      void synchronize(activeSession, next)
        .catch((error) => notifyError(`2FA 云同步失败：${String(error)}`));
    }
  }, [notifyError, persist, synchronize]);

  const setCloudSyncEnabled = useCallback(async (enabled: boolean) => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    await saveTotpCloudSyncEnabled(activeSession, enabled);
    syncEnabledRef.current = enabled;
    setCloudSyncEnabledState(enabled);
    if (enabled) await synchronize(activeSession, vaultRef.current);
  }, [synchronize]);

  const refreshCloud = useCallback((): Promise<TotpCloudRefreshResult> => {
    const activeSession = sessionRef.current;
    if (!activeSession) return Promise.resolve('empty');
    setSyncing(true);
    const operation = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const remote = await fetchTotpVault(activeSession);
        if (!remote) return 'empty';
        if (sessionRef.current !== activeSession) return 'current';
        if (Date.parse(remote.modifiedAt) <= Date.parse(vaultRef.current.modifiedAt)) return 'current';
        vaultRef.current = remote;
        setVault(remote);
        await persist(activeSession, remote);
        return 'updated';
      })
      .finally(() => {
        if (syncQueueRef.current === operation) setSyncing(false);
      });
    syncQueueRef.current = operation;
    return operation;
  }, [persist]);

  return {
    addEntry: (draft) => commitEntries((entries) => [...entries, createTotpEntry(draft)]),
    cloudSyncEnabled,
    deleteEntry: (id) => commitEntries((entries) => entries.filter((entry) => entry.id !== id)),
    entries: vault.entries,
    initialized,
    refreshCloud,
    setCloudSyncEnabled,
    syncing,
    updateEntry: (id, draft) => commitEntries((entries) => entries.map((entry) => (
      entry.id === id ? { ...createTotpEntry(draft, id), createdAt: entry.createdAt } : entry
    ))),
  };
}
