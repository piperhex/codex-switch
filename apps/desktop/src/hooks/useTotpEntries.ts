import { useCallback, useEffect, useRef, useState } from "react";
import {
  publishTotpChange,
  pullCloudTotp,
  subscribeToTotpChanges,
  syncCloudTotp,
} from "../api/backend";
import type { Translate } from "../i18n";
import {
  createTotpEntry,
  mergeTotpVaults,
  normalizeTotpVault,
  TOTP_CLOUD_SYNC_KEY,
  TOTP_STORAGE_KEY,
  totpVaultsEqual,
  type TotpDraft,
  type TotpVault,
} from "../utils/totp";

const EMPTY_VAULT_MODIFIED_AT = "1970-01-01T00:00:00.000Z";
const EMPTY_VAULT: TotpVault = {
  entries: [],
  tombstones: [],
  modifiedAt: EMPTY_VAULT_MODIFIED_AT,
};
type TotpVaultContents = Pick<TotpVault, "entries" | "tombstones">;

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

function loadVault(): TotpVault {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(TOTP_STORAGE_KEY) ?? "[]");
    return normalizeTotpVault(stored) ?? EMPTY_VAULT;
  } catch {
    return EMPTY_VAULT;
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
  const syncQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeSyncCountRef = useRef(0);

  useEffect(() => {
    window.localStorage.setItem(TOTP_STORAGE_KEY, JSON.stringify(vault));
    void publishTotpChange(vault).catch(() => undefined);
  }, [vault]);

  useEffect(() => subscribeToTotpChanges((nextVault) => {
    const merged = mergeTotpVaults(vaultRef.current, nextVault);
    if (totpVaultsEqual(merged, vaultRef.current)) return;
    vaultRef.current = merged;
    setVault(merged);
  }), []);

  const applyRemoteVault = useCallback((response: TotpVault) => {
    const remote = normalizeTotpVault(response);
    if (!remote) throw new Error("invalid-2fa-vault");
    const merged = mergeTotpVaults(vaultRef.current, remote);
    if (totpVaultsEqual(merged, vaultRef.current)) return;
    vaultRef.current = merged;
    setVault(merged);
  }, []);

  const syncVault = useCallback((snapshot: TotpVault) => {
    activeSyncCountRef.current += 1;
    setSyncing(true);
    const operation = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await syncCloudTotp(snapshot);
        applyRemoteVault(response);
      })
      .catch((error) => notify(`${t("totp.cloudSyncFailed")}: ${String(error)}`))
      .finally(() => {
        activeSyncCountRef.current -= 1;
        if (activeSyncCountRef.current === 0) setSyncing(false);
      });
    syncQueueRef.current = operation;
    return operation;
  }, [applyRemoteVault, notify, t]);

  const pullVault = useCallback(() => {
    activeSyncCountRef.current += 1;
    setSyncing(true);
    const operation = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const remote = await pullCloudTotp();
        if (remote) applyRemoteVault(remote);
        return true;
      })
      .catch((error) => {
        notify(`${t("totp.cloudSyncFailed")}: ${String(error)}`);
        return false;
      })
      .finally(() => {
        activeSyncCountRef.current -= 1;
        if (activeSyncCountRef.current === 0) setSyncing(false);
      });
    syncQueueRef.current = operation;
    return operation;
  }, [applyRemoteVault, notify, t]);

  useEffect(() => {
    if (!cloudAuthenticated) return;
    void pullVault().then((pulled) => {
      if (pulled && cloudSyncEnabled) void syncVault(vaultRef.current);
    });
  }, [cloudAuthenticated, cloudSyncEnabled, pullVault, syncVault]);

  const commitVault = useCallback((
    update: (current: TotpVault, modifiedAt: string) => TotpVaultContents,
  ) => {
    const modifiedAt = new Date().toISOString();
    const next = normalizeTotpVault({ ...update(vaultRef.current, modifiedAt), modifiedAt });
    if (!next) return;
    vaultRef.current = next;
    setVault(next);
    if (cloudSyncEnabled && cloudAuthenticated) void syncVault(next);
  }, [cloudAuthenticated, cloudSyncEnabled, syncVault]);

  const addEntry = useCallback((draft: TotpDraft) => {
    commitVault((current, modifiedAt) => addToVault(current, draft, modifiedAt));
  }, [commitVault]);

  const updateEntry = useCallback((id: string, draft: TotpDraft) => {
    commitVault((current, modifiedAt) => updateInVault(current, id, draft, modifiedAt));
  }, [commitVault]);

  const deleteEntry = useCallback((id: string) => {
    commitVault((current, modifiedAt) => deleteFromVault(current, id, modifiedAt));
  }, [commitVault]);

  const setCloudSyncEnabled = useCallback((enabled: boolean) => {
    window.localStorage.setItem(TOTP_CLOUD_SYNC_KEY, String(enabled));
    setCloudSyncEnabledState(enabled);
    notify(t(enabled ? "totp.cloudSyncEnabled" : "totp.cloudSyncDisabled"));
  }, [notify, t]);

  const syncCloud = useCallback(() => {
    if (!cloudAuthenticated) return Promise.resolve();
    return pullVault().then((pulled) => {
      if (pulled && cloudSyncEnabled) return syncVault(vaultRef.current);
      return undefined;
    });
  }, [cloudAuthenticated, cloudSyncEnabled, pullVault, syncVault]);

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
