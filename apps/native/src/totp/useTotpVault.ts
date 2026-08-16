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
import { mergeTotpVaults, normalizeTotpVault, totpVaultsEqual } from './vault';
import type {
  TotpCloudRefreshResult,
  TotpDraft,
  TotpManagerState,
  TotpVault,
} from './types';

const EMPTY_VAULT: TotpVault = {
  entries: [],
  tombstones: [],
  modifiedAt: '1970-01-01T00:00:00.000Z',
};
type TotpVaultContents = Pick<TotpVault, 'entries' | 'tombstones'>;

function addToVault(current: TotpVault, draft: TotpDraft, modifiedAt: string): TotpVaultContents {
  const entry = createTotpEntry(draft, undefined, modifiedAt);
  return {
    entries: [...current.entries, entry],
    tombstones: current.tombstones.filter((item) => item.id !== entry.id),
  };
}

function updateInVault(
  current: TotpVault,
  id: string,
  draft: TotpDraft,
  modifiedAt: string,
): TotpVaultContents {
  return {
    entries: current.entries.map((entry) => (
      entry.id === id
        ? { ...createTotpEntry(draft, id, modifiedAt), createdAt: entry.createdAt }
        : entry
    )),
    tombstones: current.tombstones.filter((item) => item.id !== id),
  };
}

function deleteFromVault(current: TotpVault, id: string, modifiedAt: string): TotpVaultContents {
  return {
    entries: current.entries.filter((entry) => entry.id !== id),
    tombstones: [
      ...current.tombstones.filter((item) => item.id !== id),
      { id, deletedAt: modifiedAt },
    ],
  };
}

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
        const merged = mergeTotpVaults(vaultRef.current, remote);
        if (totpVaultsEqual(merged, vaultRef.current)) return;
        vaultRef.current = merged;
        setVault(merged);
        await persist(activeSession, merged);
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

  const commitVault = useCallback((
    update: (current: TotpVault, modifiedAt: string) => TotpVaultContents,
  ) => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    const modifiedAt = new Date().toISOString();
    const next = normalizeTotpVault({ ...update(vaultRef.current, modifiedAt), modifiedAt });
    if (!next) return;
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
        const merged = mergeTotpVaults(vaultRef.current, remote);
        if (totpVaultsEqual(merged, vaultRef.current)) return 'current';
        vaultRef.current = merged;
        setVault(merged);
        await persist(activeSession, merged);
        return 'updated';
      })
      .finally(() => {
        if (syncQueueRef.current === operation) setSyncing(false);
      });
    syncQueueRef.current = operation;
    return operation;
  }, [persist]);

  return {
    addEntry: (draft) => commitVault((current, modifiedAt) => addToVault(current, draft, modifiedAt)),
    cloudSyncEnabled,
    deleteEntry: (id) => commitVault((current, modifiedAt) => deleteFromVault(current, id, modifiedAt)),
    entries: vault.entries,
    initialized,
    refreshCloud,
    setCloudSyncEnabled,
    syncing,
    updateEntry: (id, draft) => commitVault(
      (current, modifiedAt) => updateInVault(current, id, draft, modifiedAt),
    ),
  };
}
