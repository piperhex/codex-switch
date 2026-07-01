import { useCallback, useEffect, useRef, useState } from "react";
import {
  activateAccount,
  beginLogin,
  chooseAndImportAuth,
  isDesktopApp,
  loadDashboard,
  refreshAccountUsage,
  removeAccount,
  subscribeToBackendEvents,
} from "../api/backend";
import type { Account, AppInfo } from "../types";

interface RefreshAllOptions {
  quiet?: boolean;
  showSpinner?: boolean;
}

export function useAccountManager(notify: (message: string) => void) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToBackendEvents(
    () => void load(),
    (status) => {
      notify(status.message);
      void load();
    },
  ), [load, notify]);

  const startLogin = useCallback(async (embedded: boolean) => {
    if (!isDesktopApp) {
      notify("浏览器预览模式不会发起真实登录");
      return;
    }
    notify(embedded ? "正在打开应用内登录窗口..." : "正在打开默认浏览器...");
    try {
      await beginLogin(embedded);
      notify(embedded ? "登录窗口已打开" : "已在默认浏览器中打开登录页面");
    } catch (error) {
      notify(String(error));
    }
  }, [notify]);

  const importAuth = useCallback(async () => {
    notify(isDesktopApp ? "请选择要导入的 auth.json" : "浏览器预览模式不会读取本地文件");
    try {
      const result = await chooseAndImportAuth();
      if (result === "imported") {
        notify("账户已导入");
        await load();
      }
    } catch (error) {
      notify(String(error));
    }
  }, [load, notify]);

  const switchAccount = useCallback(async (id: string) => {
    setBusyAccountId(id);
    try {
      await activateAccount(id);
      if (!isDesktopApp) {
        setAccounts((items) => items.map((item) => ({ ...item, active: item.id === id })));
      }
      notify("已覆盖 ~/.codex/auth.json；运行中的 Codex 可能需要重新启动");
      if (isDesktopApp) await load();
    } catch (error) {
      notify(String(error));
    } finally {
      setBusyAccountId(null);
    }
  }, [load, notify]);

  const refreshUsage = useCallback(async (id: string, quiet = false) => {
    setBusyAccountId(id);
    try {
      await refreshAccountUsage(id);
      if (!isDesktopApp) {
        const fetchedAt = new Date().toISOString();
        setAccounts((items) => items.map((item) => item.id === id
          ? { ...item, usage: { ...item.usage, fetchedAt } }
          : item));
      }
      if (!quiet) notify("用量已刷新");
      if (isDesktopApp) await load();
    } catch (error) {
      if (!quiet) notify(String(error));
    } finally {
      setBusyAccountId(null);
    }
  }, [load, notify]);

  const refreshAll = useCallback(async ({ quiet = false, showSpinner = true }: RefreshAllOptions = {}) => {
    if (!accounts.length || refreshingAllRef.current) return;
    refreshingAllRef.current = true;
    if (showSpinner) setRefreshingAll(true);
    try {
      await Promise.allSettled(accounts.map((account) => refreshAccountUsage(account.id)));
      if (isDesktopApp) await load();
      else {
        const fetchedAt = new Date().toISOString();
        setAccounts((items) => items.map((item) => ({ ...item, usage: { ...item.usage, fetchedAt } })));
      }
      if (!quiet) notify("所有账户用量已刷新");
    } finally {
      if (showSpinner) setRefreshingAll(false);
      refreshingAllRef.current = false;
    }
  }, [accounts, load, notify]);

  const deleteAccount = useCallback(async (id: string) => {
    try {
      await removeAccount(id);
      if (!isDesktopApp) setAccounts((items) => items.filter((item) => item.id !== id));
      notify("账户已删除");
      if (isDesktopApp) await load();
    } catch (error) {
      notify(String(error));
    }
  }, [load, notify]);

  return {
    accounts,
    info,
    loading,
    busyAccountId,
    refreshingAll,
    startLogin,
    importAuth,
    switchAccount,
    refreshUsage,
    refreshAll,
    deleteAccount,
  };
}
