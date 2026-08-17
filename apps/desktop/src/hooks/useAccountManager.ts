import { useCallback, useEffect, useRef, useState } from "react";
import {
  activateAccount,
  beginLogin,
  beginWebSessionLogin,
  chooseAndImportAccountJson,
  copyAccountAuthJson,
  consumeAccountQuota,
  deactivateAccount as deactivateActiveAccount,
  importAccountJsonFromClipboard as importAccountJsonClipboard,
  chooseAndExportAccountArchive,
  chooseAndImportAccountArchive,
  hasLocalBackend,
  isDesktopApp,
  loadDashboard,
  refreshAccountUsage,
  removeAccount,
  setAccountAutoSwitchEnabled,
  setAccountAutoSwitchPriority,
  subscribeToBackendEvents,
  subscribeToProviderEvents,
  updateAccountNote,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { Account, AccountDetailsDraft, AppInfo } from "../types";

interface RefreshAllOptions {
  quiet?: boolean;
  showSpinner?: boolean;
  enabledOnly?: boolean;
}

interface AccountCloudSync {
  pushAll?: () => Promise<void> | void;
  pushAccount?: (id: string) => Promise<void> | void;
  restoreAndPushAccount?: (id: string) => Promise<void> | void;
  deleteAccount?: (id: string) => Promise<void> | void;
  pullAccount?: (id: string) => Promise<unknown> | void;
}

export function useAccountManager(
  notify: (message: string) => void,
  t: Translate,
  cloudSync?: AccountCloudSync,
) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [autoSwitchBusyAccountId, setAutoSwitchBusyAccountId] = useState<string | null>(null);
  const [autoSwitchPriorityBusyAccountId, setAutoSwitchPriorityBusyAccountId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [archiveOperation, setArchiveOperation] = useState<"import" | "export" | null>(null);
  const refreshingAllRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const dashboard = await loadDashboard();
      setAccounts(dashboard.accounts);
      setInfo(dashboard.info);
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const syncAddedAccount = useCallback((id: string) => {
    const syncAccount = cloudSync?.restoreAndPushAccount ?? cloudSync?.pushAccount;
    return syncAccount?.(id);
  }, [cloudSync]);

  const refreshAddedAccounts = useCallback(async (ids: string[]) => {
    await Promise.allSettled(ids.map((id) => refreshAccountUsage(id)));
    await load();
    await Promise.allSettled(ids.map(syncAddedAccount));
  }, [load, syncAddedAccount]);

  const syncLoggedInAccount = useCallback(async (id: string) => {
    await load();
    await syncAddedAccount(id);
  }, [load, syncAddedAccount]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToBackendEvents(
    () => void load(),
    (status) => {
      notify(status.message);
      if (status.ok && status.accountId) {
        void syncLoggedInAccount(status.accountId);
        return;
      }
      void load();
    },
  ), [load, notify, syncLoggedInAccount]);
  useEffect(() => subscribeToProviderEvents(() => void load()), [load]);

  const startLogin = useCallback(async (embedded: boolean) => {
    if (!isDesktopApp) {
      notify(t("toast.previewLogin"));
      return;
    }
    notify(embedded ? t("toast.openingEmbedded") : t("toast.openingBrowser"));
    try {
      await beginLogin(embedded);
      notify(embedded ? t("toast.embeddedOpened") : t("toast.browserOpened"));
    } catch (error) {
      notify(String(error));
    }
  }, [notify, t]);

  const startWebSessionLogin = useCallback(async () => {
    if (!isDesktopApp) {
      notify(t("toast.previewLogin"));
      return;
    }
    notify(t("toast.openingWebSession"));
    try {
      await beginWebSessionLogin();
      notify(t("toast.webSessionOpened"));
    } catch (error) {
      notify(String(error));
    }
  }, [notify, t]);

  const importAccountJson = useCallback(async () => {
    notify(isDesktopApp ? t("toast.accountJsonImportPrompt") : t("toast.previewNoFile"));
    try {
      const result = await chooseAndImportAccountJson();
      if (result.status === "imported") {
        await refreshAddedAccounts(result.ids);
        notify(t(result.skipped.length ? "toast.accountJsonImportedWithSkipped" : "toast.accountJsonImported", {
          count: result.ids.length,
          skipped: result.skipped.length,
        }));
      }
    } catch (error) {
      notify(String(error));
    }
  }, [notify, refreshAddedAccounts, t]);

  const importAccountJsonFromClipboard = useCallback(async () => {
    notify(isDesktopApp ? t("toast.clipboardImportPrompt") : t("toast.previewNoFile"));
    try {
      const result = await importAccountJsonClipboard();
      if (result.status === "imported") {
        await refreshAddedAccounts(result.ids);
        notify(t(result.skipped.length ? "toast.accountJsonImportedWithSkipped" : "toast.accountJsonImported", {
          count: result.ids.length,
          skipped: result.skipped.length,
        }));
      }
    } catch (error) {
      notify(String(error));
    }
  }, [notify, refreshAddedAccounts, t]);

  const exportAccountArchive = useCallback(async () => {
    notify(isDesktopApp ? t("toast.exportArchivePrompt") : t("toast.previewNoFile"));
    setArchiveOperation("export");
    try {
      const result = await chooseAndExportAccountArchive();
      if (result.status === "exported") {
        notify(t("toast.archiveExported"));
      }
    } catch (error) {
      notify(String(error));
    } finally {
      setArchiveOperation(null);
    }
  }, [notify, t]);

  const importAccountArchive = useCallback(async () => {
    notify(isDesktopApp ? t("toast.importArchivePrompt") : t("toast.previewNoFile"));
    setArchiveOperation("import");
    try {
      const result = await chooseAndImportAccountArchive();
      if (result.status === "imported") {
        notify(t("toast.archiveImported", {
          accounts: result.result.imported,
          providers: result.result.providersImported,
        }));
        await load();
        await Promise.allSettled(result.result.accountIds.map(syncAddedAccount));
        if (result.result.providerIds.length) await cloudSync?.pushAll?.();
      }
    } catch (error) {
      notify(String(error));
    } finally {
      setArchiveOperation(null);
    }
  }, [cloudSync, load, notify, syncAddedAccount, t]);

  const switchAccount = useCallback(async (id: string, hotSwitch = false) => {
    let accountActivated = false;
    setBusyAccountId(id);
    try {
      await activateAccount(id);
      accountActivated = true;
      if (!hasLocalBackend) {
        setAccounts((items) => items.map((item) => ({ ...item, active: item.id === id })));
      }
      notify(t(hotSwitch ? "toast.accountSwitchedHot" : "toast.switched"));
      if (hasLocalBackend) await load();
      await cloudSync?.pushAccount?.(id);
      return true;
    } catch (error) {
      notify(String(error));
      return accountActivated;
    } finally {
      setBusyAccountId(null);
    }
  }, [cloudSync, load, notify, t]);

  const deactivateAccount = useCallback(async (id: string) => {
    setBusyAccountId(id);
    try {
      await deactivateActiveAccount();
      if (!hasLocalBackend) {
        setAccounts((items) => items.map((item) => ({ ...item, active: false })));
      }
      notify(t("toast.accountDeactivated"));
      if (hasLocalBackend) await load();
      await cloudSync?.pushAccount?.(id);
    } catch (error) {
      notify(String(error));
    } finally {
      setBusyAccountId(null);
    }
  }, [cloudSync, load, notify, t]);

  const refreshUsage = useCallback(async (id: string, quiet = false, showSpinner = true) => {
    if (showSpinner) setBusyAccountId(id);
    try {
      await refreshAccountUsage(id);
      if (!hasLocalBackend) {
        const fetchedAt = new Date().toISOString();
        setAccounts((items) => items.map((item) => item.id === id
          ? { ...item, usage: { ...item.usage, fetchedAt } }
          : item));
      }
      if (!quiet) notify(t("toast.usageRefreshed"));
      if (hasLocalBackend) await load();
      await cloudSync?.pushAccount?.(id);
    } catch (error) {
      if (!quiet) notify(String(error));
    } finally {
      if (showSpinner) setBusyAccountId(null);
    }
  }, [cloudSync, load, notify, t]);

  const copyAuthJson = useCallback(async (id: string) => {
    if (!isDesktopApp) {
      notify(t("toast.previewCopyAuthJson"));
      return;
    }
    try {
      await copyAccountAuthJson(id);
      notify(t("toast.authJsonCopied"));
    } catch (error) {
      notify(String(error));
    }
  }, [notify, t]);

  const refreshAll = useCallback(async ({
    quiet = false,
    showSpinner = true,
    enabledOnly = false,
  }: RefreshAllOptions = {}) => {
    const targetAccounts = enabledOnly
      ? accounts.filter((account) => account.autoSwitchEnabled)
      : accounts;
    if (!targetAccounts.length || refreshingAllRef.current) return;
    refreshingAllRef.current = true;
    if (showSpinner) setRefreshingAll(true);
    try {
      await Promise.allSettled(targetAccounts.map((account) => refreshAccountUsage(account.id)));
      if (hasLocalBackend) await load();
      else {
        const fetchedAt = new Date().toISOString();
        const refreshedIds = new Set(targetAccounts.map((account) => account.id));
        setAccounts((items) => items.map((item) => refreshedIds.has(item.id)
          ? { ...item, usage: { ...item.usage, fetchedAt } }
          : item));
      }
      if (!quiet) notify(t("toast.allUsageRefreshed"));
      await Promise.allSettled(targetAccounts.map((account) => cloudSync?.pushAccount?.(account.id)));
    } finally {
      if (showSpinner) setRefreshingAll(false);
      refreshingAllRef.current = false;
    }
  }, [accounts, cloudSync, load, notify, t]);

  const consumeAccountsQuota = useCallback(async (ids: string[]) => {
    const enabledAccountIds = new Set(
      accounts.filter((account) => account.autoSwitchEnabled).map((account) => account.id),
    );
    const uniqueIds = [...new Set(ids)].filter((id) => enabledAccountIds.has(id));
    const consumedIds: string[] = [];

    for (const id of uniqueIds) {
      try {
        await consumeAccountQuota(id);
        consumedIds.push(id);
      } catch {
        // Continue sequentially so one unavailable account does not block the remaining selection.
      }
    }

    const failedCount = uniqueIds.length - consumedIds.length;
    if (consumedIds.length) {
      await Promise.allSettled(consumedIds.map((id) => refreshAccountUsage(id)));
      if (hasLocalBackend) await load();
      else {
        const fetchedAt = new Date().toISOString();
        setAccounts((items) => items.map((item) => consumedIds.includes(item.id)
          ? { ...item, usage: { ...item.usage, fetchedAt } }
          : item));
      }
      await Promise.allSettled(consumedIds.map((id) => cloudSync?.pushAccount?.(id)));
      notify(t("toast.batchQuotaConsumed", { count: consumedIds.length }));
    }
    if (failedCount) notify(t("toast.batchQuotaConsumeFailed", { count: failedCount }));
    return consumedIds;
  }, [accounts, cloudSync, load, notify, t]);

  const deleteAccount = useCallback(async (id: string) => {
    try {
      await removeAccount(id);
      if (!hasLocalBackend) setAccounts((items) => items.filter((item) => item.id !== id));
      notify(t("toast.deleted"));
      if (hasLocalBackend) await load();
      await cloudSync?.deleteAccount?.(id);
    } catch (error) {
      notify(String(error));
    }
  }, [cloudSync, load, notify, t]);

  const deleteAccounts = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    const deletedIds: string[] = [];
    let failedCount = 0;

    for (const id of uniqueIds) {
      try {
        await removeAccount(id);
        deletedIds.push(id);
      } catch {
        failedCount += 1;
      }
    }

    if (deletedIds.length) {
      if (hasLocalBackend) await load();
      else setAccounts((items) => items.filter((item) => !deletedIds.includes(item.id)));
      await Promise.allSettled(deletedIds.map((id) => cloudSync?.deleteAccount?.(id)));
      notify(t("toast.batchDeleted", { count: deletedIds.length }));
    }
    if (failedCount) notify(t("toast.batchDeleteFailed", { count: failedCount }));
    return deletedIds;
  }, [cloudSync, load, notify, t]);

  const setAutoSwitchEnabled = useCallback(async (id: string, enabled: boolean) => {
    setAutoSwitchBusyAccountId(id);
    try {
      await setAccountAutoSwitchEnabled(id, enabled);
      setAccounts((items) => items.map((item) => item.id === id
        ? { ...item, autoSwitchEnabled: enabled }
        : item));
      if (hasLocalBackend) await load();
    } catch (error) {
      notify(String(error));
    } finally {
      setAutoSwitchBusyAccountId(null);
    }
  }, [load, notify]);

  const setAutoSwitchAccounts = useCallback(async (ids: string[], enabled: boolean) => {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return [];

    const updatedIds: string[] = [];
    let failedCount = 0;
    setAutoSwitchBusyAccountId("__batch__");
    try {
      for (const id of uniqueIds) {
        try {
          await setAccountAutoSwitchEnabled(id, enabled);
          updatedIds.push(id);
        } catch {
          failedCount += 1;
        }
      }
      if (updatedIds.length) {
        setAccounts((items) => items.map((item) => updatedIds.includes(item.id)
          ? { ...item, autoSwitchEnabled: enabled }
          : item));
        if (hasLocalBackend) await load();
        notify(t(enabled ? "toast.batchEnabled" : "toast.batchDisabled", { count: updatedIds.length }));
      }
      if (failedCount) {
        notify(t(enabled ? "toast.batchEnableFailed" : "toast.batchDisableFailed", { count: failedCount }));
      }
      return updatedIds;
    } finally {
      setAutoSwitchBusyAccountId(null);
    }
  }, [load, notify, t]);
  const enableAutoSwitchAccounts = useCallback(
    (ids: string[]) => setAutoSwitchAccounts(ids, true),
    [setAutoSwitchAccounts],
  );
  const disableAutoSwitchAccounts = useCallback(
    (ids: string[]) => setAutoSwitchAccounts(ids, false),
    [setAutoSwitchAccounts],
  );

  const saveAccountNote = useCallback(async (id: string, details: AccountDetailsDraft) => {
    try {
      await updateAccountNote(id, details);
      setAccounts((items) => items.map((item) => item.id === id ? { ...item, ...details } : item));
      notify(t("toast.accountDetailsSaved"));
      await cloudSync?.pushAccount?.(id);
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    }
  }, [cloudSync, notify, t]);

  const refreshAccountDetails = useCallback(async (id: string): Promise<Account | null> => {
    try {
      await cloudSync?.pullAccount?.(id);
    } catch (error) {
      notify(String(error));
    }
    try {
      const dashboard = await loadDashboard();
      setAccounts(dashboard.accounts);
      setInfo(dashboard.info);
      return dashboard.accounts.find((account) => account.id === id) ?? null;
    } catch (error) {
      notify(String(error));
      return null;
    }
  }, [cloudSync, notify]);

  const setAutoSwitchPriority = useCallback(async (id: string, priority: number) => {
    setAutoSwitchPriorityBusyAccountId(id);
    try {
      await setAccountAutoSwitchPriority(id, priority);
      setAccounts((items) => items.map((item) => item.id === id
        ? { ...item, autoSwitchPriority: priority }
        : item));
      await cloudSync?.pushAccount?.(id);
      if (hasLocalBackend) await load();
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setAutoSwitchPriorityBusyAccountId(null);
    }
  }, [cloudSync, load, notify]);

  return {
    accounts,
    info,
    loading,
    busyAccountId,
    autoSwitchBusyAccountId,
    autoSwitchPriorityBusyAccountId,
    refreshingAll,
    archiveOperation,
    startLogin,
    startWebSessionLogin,
    importAccountJson,
    importAccountJsonFromClipboard,
    exportAccountArchive,
    importAccountArchive,
    switchAccount,
    deactivateAccount,
    copyAuthJson,
    refreshUsage,
    refreshAll,
    consumeAccountsQuota,
    deleteAccount,
    deleteAccounts,
    setAutoSwitchEnabled,
    enableAutoSwitchAccounts,
    disableAutoSwitchAccounts,
    setAutoSwitchPriority,
    saveAccountNote,
    refreshAccountDetails,
    reload: load,
  };
}
