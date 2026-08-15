import { useCallback, useEffect, useRef, useState } from "react";
import { publishTotpChange, subscribeToTotpChanges, syncCloudTotp } from "../api/backend";
import type { Translate } from "../i18n";
import {
  createTotpEntry,
  isTotpEntry,
  TOTP_CLOUD_SYNC_KEY,
  TOTP_STORAGE_KEY,
  type TotpDraft,
  type TotpEntry,
  type TotpVault,
} from "../utils/totp";

const EMPTY_VAULT_MODIFIED_AT = "1970-01-01T00:00:00.000Z";

function loadVault(): TotpVault {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(TOTP_STORAGE_KEY) ?? "[]");
    if (Array.isArray(stored)) {
      const entries = stored.filter(isTotpEntry);
      return {
        entries,
        modifiedAt: entries[entries.length - 1]?.createdAt ?? EMPTY_VAULT_MODIFIED_AT,
      };
    }
    if (!stored || typeof stored !== "object") throw new Error("invalid-vault");
    const candidate = stored as Partial<TotpVault>;
    const entries = Array.isArray(candidate.entries) ? candidate.entries.filter(isTotpEntry) : [];
    const modifiedAt = typeof candidate.modifiedAt === "string"
      && !Number.isNaN(Date.parse(candidate.modifiedAt))
      ? candidate.modifiedAt
      : EMPTY_VAULT_MODIFIED_AT;
    return { entries, modifiedAt };
  } catch {
    return { entries: [], modifiedAt: EMPTY_VAULT_MODIFIED_AT };
  }
}

interface TotpEntriesOptions {
  cloudAuthenticated: boolean;
  notify: (message: string) => void;
  t: Translate;
}

export function useTotpEntries({ cloudAuthenticated, notify, t }: TotpEntriesOptions) {
  const [vault, setVault] = useState<TotpVault>(loadVault);
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(
    () => window.localStorage.getItem(TOTP_CLOUD_SYNC_KEY) === "true",
  );
  const [syncing, setSyncing] = useState(false);
  const vaultRef = useRef(vault);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSyncCountRef = useRef(0);

  useEffect(() => {
    window.localStorage.setItem(TOTP_STORAGE_KEY, JSON.stringify(vault));
    void publishTotpChange(vault).catch(() => undefined);
  }, [vault]);

  useEffect(() => subscribeToTotpChanges((nextVault) => {
    if (nextVault.modifiedAt === vaultRef.current.modifiedAt) return;
    if (Date.parse(nextVault.modifiedAt) < Date.parse(vaultRef.current.modifiedAt)) return;
    vaultRef.current = nextVault;
    setVault(nextVault);
  }), []);

  const syncVault = useCallback((snapshot: TotpVault) => {
    activeSyncCountRef.current += 1;
    setSyncing(true);
    const operation = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const remote = await syncCloudTotp(snapshot);
        if (Date.parse(remote.modifiedAt) < Date.parse(vaultRef.current.modifiedAt)) return;
        vaultRef.current = remote;
        setVault(remote);
      })
      .catch((error) => notify(`${t("totp.cloudSyncFailed")}: ${String(error)}`))
      .finally(() => {
        activeSyncCountRef.current -= 1;
        if (activeSyncCountRef.current === 0) setSyncing(false);
      });
    syncQueueRef.current = operation;
    return operation;
  }, [notify, t]);

  useEffect(() => {
    if (cloudSyncEnabled && cloudAuthenticated) void syncVault(vaultRef.current);
  }, [cloudAuthenticated, cloudSyncEnabled, syncVault]);

  const commitEntries = useCallback((update: (current: TotpEntry[]) => TotpEntry[]) => {
    const next = { entries: update(vaultRef.current.entries), modifiedAt: new Date().toISOString() };
    vaultRef.current = next;
    setVault(next);
    if (cloudSyncEnabled && cloudAuthenticated) void syncVault(next);
  }, [cloudAuthenticated, cloudSyncEnabled, syncVault]);

  const addEntry = useCallback((draft: TotpDraft) => {
    commitEntries((current) => [...current, createTotpEntry(draft)]);
  }, [commitEntries]);

  const updateEntry = useCallback((id: string, draft: TotpDraft) => {
    commitEntries((current) => current.map((entry) => (
      entry.id === id ? { ...createTotpEntry(draft, id), createdAt: entry.createdAt } : entry
    )));
  }, [commitEntries]);

  const deleteEntry = useCallback((id: string) => {
    commitEntries((current) => current.filter((entry) => entry.id !== id));
  }, [commitEntries]);

  const setCloudSyncEnabled = useCallback((enabled: boolean) => {
    window.localStorage.setItem(TOTP_CLOUD_SYNC_KEY, String(enabled));
    setCloudSyncEnabledState(enabled);
    notify(t(enabled ? "totp.cloudSyncEnabled" : "totp.cloudSyncDisabled"));
  }, [notify, t]);

  const syncCloud = useCallback(() => {
    if (!cloudSyncEnabled || !cloudAuthenticated) return Promise.resolve();
    return syncVault(vaultRef.current);
  }, [cloudAuthenticated, cloudSyncEnabled, syncVault]);

  return {
    addEntry,
    cloudSyncEnabled,
    deleteEntry,
    entries: vault.entries,
    setCloudSyncEnabled,
    syncCloud,
    syncing,
    updateEntry,
  };
}
