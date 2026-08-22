import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTotpVault, putTotpVault } from './api';
import { emptyTotpVault, mergeTotpVaults } from './totp';
import type { AuthSession, TotpEntry, TotpVault } from './types';

const VAULT_PREFIX = 'codex-switch.web.totp-vault.v1';
const SYNC_PREFIX = 'codex-switch.web.totp-sync.v1';
const SYNC_EVENT = 'codex-switch:totp-sync';

function sessionKey(session: AuthSession, prefix: string) {
  return `${prefix}.${encodeURIComponent(`${session.baseUrl}|${session.email.toLowerCase()}`)}`;
}

function loadVault(session: AuthSession) {
  try {
    const raw = localStorage.getItem(sessionKey(session, VAULT_PREFIX));
    if (!raw) return emptyTotpVault();
    const value = JSON.parse(raw) as TotpVault;
    if (!Array.isArray(value.entries) || !Array.isArray(value.tombstones)) return emptyTotpVault();
    return value;
  } catch {
    return emptyTotpVault();
  }
}

function saveVault(session: AuthSession, vault: TotpVault) {
  localStorage.setItem(sessionKey(session, VAULT_PREFIX), JSON.stringify(vault));
}

export function loadTotpSyncEnabled(session: AuthSession) {
  return localStorage.getItem(sessionKey(session, SYNC_PREFIX)) === 'true';
}

export function saveTotpSyncEnabled(session: AuthSession, enabled: boolean) {
  localStorage.setItem(sessionKey(session, SYNC_PREFIX), String(enabled));
  window.dispatchEvent(new Event(SYNC_EVENT));
}

export function useTotpVault(session: AuthSession | null) {
  const [vault, setVault] = useState<TotpVault>(emptyTotpVault);
  const [initialized, setInitialized] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const vaultRef = useRef(vault);
  vaultRef.current = vault;

  const persist = useCallback((activeSession: AuthSession, next: TotpVault) => {
    vaultRef.current = next;
    setVault(next);
    saveVault(activeSession, next);
  }, []);

  const synchronize = useCallback(async (activeSession: AuthSession, next: TotpVault) => {
    setSyncing(true);
    try {
      const remote = await putTotpVault(next);
      persist(activeSession, mergeTotpVaults(next, remote));
    } finally {
      setSyncing(false);
    }
  }, [persist]);

  useEffect(() => {
    if (!session) {
      setVault(emptyTotpVault());
      setInitialized(true);
      return undefined;
    }
    const local = loadVault(session);
    const enabled = loadTotpSyncEnabled(session);
    persist(session, local);
    setCloudSyncEnabled(enabled);
    setInitialized(true);
    if (enabled) void synchronize(session, local);
    const onSyncChange = () => setCloudSyncEnabled(loadTotpSyncEnabled(session));
    window.addEventListener(SYNC_EVENT, onSyncChange);
    return () => window.removeEventListener(SYNC_EVENT, onSyncChange);
  }, [persist, session, synchronize]);

  const commit = useCallback((updater: (current: TotpVault, now: string) => TotpVault) => {
    if (!session) return;
    const next = updater(vaultRef.current, new Date().toISOString());
    persist(session, next);
    if (loadTotpSyncEnabled(session)) void synchronize(session, next);
  }, [persist, session, synchronize]);

  const refreshCloud = useCallback(async () => {
    if (!session) return 'empty' as const;
    setSyncing(true);
    try {
      const remote = await fetchTotpVault();
      if (!remote.modifiedAt) return 'empty' as const;
      const merged = mergeTotpVaults(vaultRef.current, remote as TotpVault);
      if (JSON.stringify(merged) === JSON.stringify(vaultRef.current)) return 'current' as const;
      persist(session, merged);
      return 'updated' as const;
    } finally {
      setSyncing(false);
    }
  }, [persist, session]);

  const saveEntry = useCallback((draft: Omit<TotpEntry, 'id' | 'createdAt' | 'updatedAt'>, id?: string) => {
    commit((current, now) => {
      const existing = id ? current.entries.find((entry) => entry.id === id) : undefined;
      const entry: TotpEntry = {
        ...draft,
        id: id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return mergeTotpVaults(current, { entries: [entry], tombstones: [], modifiedAt: now });
    });
  }, [commit]);

  const deleteEntry = useCallback((id: string) => {
    commit((current, now) => mergeTotpVaults(
      current,
      { entries: [], tombstones: [{ id, deletedAt: now }], modifiedAt: now },
    ));
  }, [commit]);

  return {
    cloudSyncEnabled,
    deleteEntry,
    entries: vault.entries,
    initialized,
    refreshCloud,
    saveEntry,
    setCloudSyncEnabled: (enabled: boolean) => {
      if (!session) return;
      saveTotpSyncEnabled(session, enabled);
      setCloudSyncEnabled(enabled);
      if (enabled) void synchronize(session, vaultRef.current);
    },
    syncing,
  };
}
