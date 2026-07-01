import { useCallback, useState } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import { Check, CircleHelp, Plus, RefreshCw, Settings, ShieldCheck, UserRound, Zap } from "lucide-react";
import { HelpModal } from "./components/modals/HelpModal";
import { LoginModal } from "./components/modals/LoginModal";
import { useAccountManager } from "./hooks/useAccountManager";
import { useAutoRefresh } from "./hooks/useAutoRefresh";
import { useToast } from "./hooks/useToast";
import { AccountsPage } from "./pages/AccountsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { formatRefreshTime } from "./utils/format";

const LAST_REFRESH_ALL_KEY = "codex-auth-manager:last-refresh-all-at";

function storedRefreshAllTime() {
  const value = window.localStorage.getItem(LAST_REFRESH_ALL_KEY);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

export default function App() {
  const [page, setPage] = useState<"accounts" | "settings">("accounts");
  const [showLogin, setShowLogin] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [lastRefreshAllAt, setLastRefreshAllAt] = useState<string | null>(storedRefreshAllTime);
  const { message: toast, notify } = useToast();
  const manager = useAccountManager(notify);
  const markRefreshAll = useCallback(() => {
    const refreshedAt = new Date().toISOString();
    window.localStorage.setItem(LAST_REFRESH_ALL_KEY, refreshedAt);
    setLastRefreshAllAt(refreshedAt);
  }, []);
  const automaticRefresh = useCallback(
    () => {
      markRefreshAll();
      return manager.refreshAll({ quiet: true, showSpinner: false });
    },
    [manager.refreshAll, markRefreshAll],
  );
  const autoRefresh = useAutoRefresh(manager.accounts.length > 0, automaticRefresh);

  const startLogin = (embedded: boolean) => {
    setShowLogin(false);
    void manager.startLogin(embedded);
  };
  const importAuth = () => {
    setShowLogin(false);
    void manager.importAuth();
  };
  const refreshAll = () => {
    markRefreshAll();
    void manager.refreshAll();
  };

  return (
    <ConfigProvider theme={{
      algorithm: antdTheme.compactAlgorithm,
      token: { colorPrimary: "#1f7a51", borderRadius: 6, fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif" },
    }}>
      <div className="app-shell">
        <header className="app-menu">
          <div className="brand"><div className="brand-mark"><Zap size={19} fill="currentColor" /></div>
            <span>Codex<br /><b>Auth Manager</b></span></div>
          <nav className="top-tabs" aria-label="主导航">
            <button className={page === "accounts" ? "selected" : ""} onClick={() => setPage("accounts")}>
              <UserRound size={19} />账户管理</button>
            <button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}>
              <Settings size={19} />设置</button>
          </nav>
          <div className="menu-tools">
            <div className="security-chip"><ShieldCheck size={16} /><span><b>本地安全存储</b><small>凭据仅保存在此设备</small></span></div>
            <button className="help-button" onClick={() => setShowHelp(true)}><CircleHelp size={17} />使用帮助</button>
          </div>
        </header>

        <main>
          <header className="topbar">
            <div><span className="eyebrow">CODEX / AUTHENTICATION</span>
              <h1>{page === "settings" ? "设置" : `账户管理（${manager.accounts.length}）`}</h1></div>
            {page === "accounts" && (
              <div className="topbar-actions">
                <button className="primary-button" onClick={() => setShowLogin(true)}><Plus size={18} />添加账户</button>
                <div className="refresh-all-wrap">
                  <button className="refresh-all" onClick={refreshAll}
                    disabled={manager.refreshingAll || !manager.accounts.length}>
                    <RefreshCw className={manager.refreshingAll ? "spin" : ""} size={17} />刷新全部用量
                  </button>
                  <small className="last-auto-refresh">最后更新：{formatRefreshTime(lastRefreshAllAt)}</small>
                </div>
              </div>
            )}
          </header>

          {page === "settings" ? (
            <SettingsPage info={manager.info} autoRefreshEnabled={autoRefresh.enabled}
              autoRefreshSeconds={autoRefresh.seconds} onEnabledChange={autoRefresh.setEnabled}
              onSecondsChange={autoRefresh.updateSeconds} />
          ) : (
            <AccountsPage accounts={manager.accounts} loading={manager.loading}
              busyAccountId={manager.busyAccountId} onAdd={() => setShowLogin(true)}
              onSwitch={(id) => void manager.switchAccount(id)}
              onRefresh={(id) => void manager.refreshUsage(id)}
              onDelete={(id) => void manager.deleteAccount(id)} />
          )}
        </main>

        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onStart={startLogin} onImport={importAuth} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} version={manager.info?.version ?? "0.1.0"} />}
        {toast && <div className="toast"><Check size={17} />{toast}</div>}
      </div>
    </ConfigProvider>
  );
}
