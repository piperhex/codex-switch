import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigProvider, Dropdown, Modal, theme as antdTheme, type MenuProps } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import {
  CalendarClock,
  Check,
  CircleHelp,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  chooseAndExportDiagnosticLogs,
  copyWebProxyLanApiKey,
  consumeResetCredit,
  DEFAULT_AUTO_DISABLE_STATUS_CODES,
  DEFAULT_CLOUD_BASE_URL,
  fetchCloudCurrencyRates,
  hasLocalBackend,
  isDesktopApp,
  launchChatGpt,
  loadAppSettings,
  openManagedFolder,
  queryProviderBalance,
  quitApplication,
  reportAnnouncementClick,
  reportBaseUrlChange,
  reportDeviceActivity,
  reportFirstInstallation,
  restartApplication,
  restartChatGpt,
  showTokenUsageWindow,
  submitFeedback,
  subscribeToCloudSessionExpired,
  subscribeToOpenSettings,
  updateAutoDisableStatusCodes,
  updateNetworkProxy,
  updateProviderGroups,
  updateShowUsageNetworkErrors,
  updateWebProxyListenOnAllInterfaces,
  updateWebProxyPort,
} from "../../api/backend";
import { AboutModal } from "../modals/AboutModal";
import { HelpModal } from "../modals/HelpModal";
import { FeedbackModal } from "../modals/FeedbackModal";
import { TokenUsageHeatmap } from "../TokenUsageHeatmap";
import { TokenUsageDashboard } from "../TokenUsageDashboard";
import { TotpWindowButton } from "../TotpWindowButton";
import { ProxySessionManager } from "../ProxySessionManager";
import { CloudLoginModal } from "../modals/CloudLoginModal";
import { CloudAccountModal } from "../modals/CloudAccountModal";
import { LoginModal } from "../modals/LoginModal";
import { LanAccessModal } from "../modals/LanAccessModal";
import { UpdateModal } from "../modals/UpdateModal";
import { CcSwitchImportModal } from "../modals/CcSwitchImportModal";
import { MenuSearchModal } from "../MenuSearchModal";
import { ProxyStatusControls } from "./ProxyStatusControls";
import { ProxyTopbarActions } from "./ProxyTopbarActions";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { DashboardMenuTools } from "./DashboardMenuTools";
import { ProxyProgressModal } from "./ProxyProgressModal";
import { buildDashboardMenuItems } from "./dashboardMenuItems";
import { DashboardNavigation, type DashboardPage } from "./DashboardNavigation";
import { useAccountManager } from "../../hooks/useAccountManager";
import { useAppUpdate } from "../../hooks/useAppUpdate";
import { useAccountAutoRefresh, useAutoRefresh } from "../../hooks/useAutoRefresh";
import { useAccountDisplayMode } from "../../hooks/useAccountDisplayMode";
import { useBubbleResetDisplay } from "../../hooks/useBubbleResetDisplay";
import { useBubbleStyle } from "../../hooks/useBubbleStyle";
import { useCloudAuth } from "../../hooks/useCloudAuth";
import { useCloudContent, useCloudContentLifecycle } from "../../hooks/useCloudContent";
import { useCloseToTray } from "../../hooks/useCloseToTray";
import { useThirdPartyAppIntegration } from "../../hooks/useThirdPartyAppIntegration";
import { useCcSwitchImport } from "../../hooks/useCcSwitchImport";
import { useCodexHome } from "../../hooks/useCodexHome";
import { useLanguage } from "../../hooks/useLanguage";
import { useLaunchAtStartup } from "../../hooks/useLaunchAtStartup";
import { useNavigationStyle, type NavigationStyle } from "../../hooks/useNavigationStyle";
import { useFloatingBubble } from "../../hooks/useFloatingBubble";
import { useProviderManager } from "../../hooks/useProviderManager";
import { usePrivacyMode } from "../../hooks/usePrivacyMode";
import { useResetCredits } from "../../hooks/useResetCredits";
import { useThemeColor } from "../../hooks/useThemeColor";
import { useThemeMode } from "../../hooks/useThemeMode";
import { useTokenUsagePreferences } from "../../hooks/useTokenUsagePreferences";
import { useUpstream429RetryTimeout } from "../../hooks/useUpstream429RetryTimeout";
import { useToast } from "../../hooks/useToast";
import { useTotpEntries } from "../../hooks/useTotpEntries";
import { loadTokenCostDisplaySettings, refreshTokenCostCurrencyRate } from "../../utils/tokenCost";
import { AccountsPage } from "../../pages/AccountsPage";
import { ThirdPartyAppsPage } from "../../pages/ThirdPartyAppsPage";
import { DreamSkinPage } from "../../pages/DreamSkinPage";
import { ProvidersPage } from "../../pages/ProvidersPage";
import { SettingsGroupsNav, SettingsPage } from "../../pages/SettingsPage";
import { SkillsMarketPage } from "../../pages/SkillsMarketPage";
import { CodexThreadsPage } from "../../pages/CodexThreadsPage";
import { SystemPromptFilterPage } from "../../pages/SystemPromptFilterPage";
import { SystemPromptInjectionPage } from "../../pages/SystemPromptInjectionPage";
import { NetworkProxySettingsModal } from "../../pages/settings/NetworkProxySettings";
import type { Translate } from "../../i18n";
import { AccountDisplayTabs } from "./AccountDisplayTabs";
import { AccountTopbarActions } from "./AccountTopbarActions";
import type {
  AccountDetailsDraft,
  BubbleResetDisplay,
  BubbleStyle,
  NetworkProxySettings,
  Provider,
} from "../../types";

const REPOSITORY_URL = "https://github.com/piperhex/codex-switch";
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/piperhex/codex-switch/releases/latest";
const APP_LOGO_URL = new URL("../../../src-tauri/icons/128x128.png", import.meta.url).href;
const CUSTOM_TITLEBAR_ENABLED = isDesktopApp && navigator.userAgent.includes("Windows");
const MemoAccountsPage = memo(AccountsPage);
const MemoThirdPartyAppsPage = memo(ThirdPartyAppsPage);
const MemoDreamSkinPage = memo(DreamSkinPage);
const MemoProvidersPage = memo(ProvidersPage);
const MemoSettingsPage = memo(SettingsPage);
const MemoSkillsMarketPage = memo(SkillsMarketPage);
const MemoCodexThreadsPage = memo(CodexThreadsPage);
const MemoSystemPromptFilterPage = memo(SystemPromptFilterPage);
const MemoSystemPromptInjectionPage = memo(SystemPromptInjectionPage);
const PROXY_START_PHASE_KEYS = {
  preparingClient: "providers.proxy.startProgress.preparingClient",
  startingProxy: "providers.proxy.startProgress.startingProxy",
  syncingConversations: "providers.proxy.startProgress.syncingConversations",
  restartingClient: "providers.proxy.startProgress.restartingClient",
  complete: "providers.proxy.startProgress.complete",
  failed: "providers.proxy.startProgress.failed",
} as const;
const PROXY_STOP_PHASE_KEYS = {
  stoppingClient: "providers.proxy.stopProgress.stoppingClient",
  restoringConversations: "providers.proxy.stopProgress.restoringConversations",
  restoringConfiguration: "providers.proxy.stopProgress.restoringConfiguration",
  restartingClient: "providers.proxy.stopProgress.restartingClient",
  complete: "providers.proxy.stopProgress.complete",
  failed: "providers.proxy.stopProgress.failed",
} as const;
const DEFAULT_NETWORK_PROXY: NetworkProxySettings = {
  enabled: false,
  proxyUrl: "",
  proxyPort: null,
};

type SystemMenuAction =
  | "add-account"
  | "import-archive"
  | "export-archive"
  | "open-codex-home"
  | "open-account-store"
  | "restart-app"
  | "quit-app"
  | `navigation-style-${NavigationStyle}`
  | "accounts"
  | "providers"
  | "claude-code"
  | "token-usage"
  | "dream-skin"
  | "skills"
  | "sessions"
  | "system-prompt-filter"
  | "system-prompt-injection"
  | "settings"
  | "refresh-all"
  | "refresh-reset-credits"
  | "open-token-window"
  | "network-proxy"
  | "start-chatgpt"
  | "restart-chatgpt"
  | "export-logs"
  | "cloud-account"
  | "cloud-sync"
  | "cloud-logout"
  | "notifications"
  | "help"
  | "check-update"
  | "feedback"
  | "repository"
  | "about";

function normalizeHttpUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

async function refreshProviderBalances(providers: Provider[]) {
  await Promise.allSettled(
    providers
      .filter((provider) => Boolean(provider.balancePlatform))
      .map((provider) => queryProviderBalance(provider.id)),
  );
}

function dashboardEyebrow(page: DashboardPage, t: Translate) {
  if (page === "providers") return t("topbar.providersEyebrow");
  if (page === "skills") return t("topbar.skillsEyebrow");
  if (page === "sessions") return t("topbar.sessionsEyebrow");
  if (page === "claudeCode") return t("topbar.claudeCodeEyebrow");
  if (page === "promptFilter") return t("topbar.systemPromptFilterEyebrow");
  if (page === "promptInjection") return t("topbar.systemPromptInjectionEyebrow");
  return t("topbar.eyebrow");
}

function dashboardTitle(page: DashboardPage, t: Translate, options: {
  accountCount: number;
  providerCount: number;
}) {
  if (page === "settings") return t("topbar.settings");
  if (page === "skills") return t("topbar.skills");
  if (page === "sessions") return t("topbar.sessions");
  if (page === "claudeCode") return t("topbar.claudeCode");
  if (page === "promptFilter") return t("topbar.systemPromptFilter");
  if (page === "promptInjection") return t("topbar.systemPromptInjection");
  if (page === "providers") return t("topbar.providers", { count: options.providerCount });
  return t("topbar.accounts", { count: options.accountCount });
}

export function DashboardApp() {
  const [page, setPage] = useState<DashboardPage>("accounts");
  const [showLogin, setShowLogin] = useState(false);
  const [showCloudLogin, setShowCloudLogin] = useState(false);
  const [cloudSessionExpired, setCloudSessionExpired] = useState(false);
  const [showCloudAccount, setShowCloudAccount] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMenuSearch, setShowMenuSearch] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showLanAccess, setShowLanAccess] = useState(false);
  const [showNetworkProxy, setShowNetworkProxy] = useState(false);
  const [chatGptOperation, setChatGptOperation] = useState<"start" | "restart" | null>(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [resetCreditBusyAccountId, setResetCreditBusyAccountId] = useState<string | null>(null);
  const [refreshingProviderBalances, setRefreshingProviderBalances] = useState(false);
  const [webProxyPort, setWebProxyPort] = useState<number | null>(null);
  const [webProxyListenOnAllInterfaces, setWebProxyListenOnAllInterfaces] = useState(false);
  const [webProxyPortLoading, setWebProxyPortLoading] = useState(false);
  const [networkProxy, setNetworkProxy] = useState(DEFAULT_NETWORK_PROXY);
  const [networkProxyLoading, setNetworkProxyLoading] = useState(false);
  const [autoDisableStatusCodes, setAutoDisableStatusCodes] = useState<number[]>(
    [...DEFAULT_AUTO_DISABLE_STATUS_CODES],
  );
  const [autoDisableStatusCodesLoading, setAutoDisableStatusCodesLoading] = useState(false);
  const [showUsageNetworkErrors, setShowUsageNetworkErrors] = useState(false);
  const [showUsageNetworkErrorsLoading, setShowUsageNetworkErrorsLoading] = useState(false);
  const [showCustomCloudServer, setShowCustomCloudServer] = useState(false);
  const [providerGroups, setProviderGroups] = useState<string[]>([]);
  const cloudSessionPromptedRef = useRef(false);
  const providerBalanceRefreshCountRef = useRef(0);
  useEffect(() => subscribeToOpenSettings(() => setPage("settings")), []);
  const { message: toast, notify } = useToast();
  const { language, setLanguage, t } = useLanguage();
  const thirdPartyAppIntegration = useThirdPartyAppIntegration(notify, t);
  const cloud = useCloudAuth(notify, t);
  const totpManager = useTotpEntries({
    cloudAuthenticated: cloud.state.authenticated,
    notify,
    t,
  });
  const cloudContent = useCloudContent();
  const {
    announcement, faqs, loadAnnouncement, loadFaqs, loadNotifications,
    markNotificationsSeen, notifications, setNotificationsOpen,
  } = cloudContent;
  const promptCloudRelogin = useCallback((reloadState: boolean) => {
    if (cloudSessionPromptedRef.current) return;
    cloudSessionPromptedRef.current = true;
    setShowCloudAccount(false);
    setCloudSessionExpired(true);
    setShowCloudLogin(true);
    if (reloadState) void cloud.load().catch(() => undefined);
    notify(t("toast.cloudSessionExpired"));
  }, [cloud.load, notify, t]);
  useEffect(
    () => subscribeToCloudSessionExpired(() => promptCloudRelogin(true)),
    [promptCloudRelogin],
  );
  useEffect(() => {
    if (cloud.state.sessionExpired) promptCloudRelogin(false);
  }, [cloud.state.sessionExpired, promptCloudRelogin]);
  useEffect(() => {
    const shouldKeepCopyBehavior = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(
        element?.closest("input, textarea, select, [contenteditable='true']")
        || window.getSelection()?.toString(),
      );
    };
    const openMenuSearch = (event: KeyboardEvent) => {
      const wrongModifier = (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey;
      if (wrongModifier || event.key.toLocaleLowerCase() !== "c") {
        return;
      }
      if (shouldKeepCopyBehavior(event.target)) return;
      event.preventDefault();
      setShowMenuSearch(true);
    };
    const openMenuSearchFromCopy = (event: ClipboardEvent) => {
      if (shouldKeepCopyBehavior(event.target)) return;
      event.preventDefault();
      setShowMenuSearch(true);
    };
    window.addEventListener("keydown", openMenuSearch);
    window.addEventListener("copy", openMenuSearchFromCopy);
    return () => {
      window.removeEventListener("keydown", openMenuSearch);
      window.removeEventListener("copy", openMenuSearchFromCopy);
    };
  }, []);
  const accountCloudSync = useMemo(() => ({
    pushAll: cloud.pushQuietly,
    pushAccount: cloud.pushAccountQuietly,
    restoreAndPushAccount: cloud.restoreAndPushAccountQuietly,
    deleteAccount: cloud.deleteAccountQuietly,
    pullAccount: cloud.pullAccount,
  }), [
    cloud.deleteAccountQuietly,
    cloud.pushAccountQuietly,
    cloud.pushQuietly,
    cloud.pullAccount,
    cloud.restoreAndPushAccountQuietly,
  ]);
  const providerCloudSync = useMemo(() => ({
    pushProvider: cloud.pushProviderQuietly,
    deleteProvider: cloud.deleteProviderQuietly,
  }), [cloud.deleteProviderQuietly, cloud.pushProviderQuietly]);
  const floatingBubble = useFloatingBubble(notify);
  const launchAtStartup = useLaunchAtStartup(notify);
  const closeToTray = useCloseToTray(notify);
  const bubbleResetDisplay = useBubbleResetDisplay(notify);
  const bubbleStyle = useBubbleStyle(notify);
  const privacyMode = usePrivacyMode(notify);
  const accountDisplayMode = useAccountDisplayMode();
  const navigationStyle = useNavigationStyle();
  const themeColor = useThemeColor(notify);
  const themeMode = useThemeMode();
  const tokenUsagePreferences = useTokenUsagePreferences(notify);
  const upstream429RetryTimeout = useUpstream429RetryTimeout(notify);
  const manager = useAccountManager(notify, t, accountCloudSync);
  const providerManager = useProviderManager(notify, t, providerCloudSync);
  const handleCcSwitchImported = useCallback((provider: Provider) => {
    setPage("providers");
    notify(t("toast.providerImported", { name: provider.name }));
  }, [notify, t]);
  const ccSwitchImport = useCcSwitchImport({
    notify,
    onImported: handleCcSwitchImported,
    t,
  });
  const codexHome = useCodexHome({
    currentPath: manager.info?.codexHome,
    localProxyRunning: Boolean(providerManager.localProxy?.running),
    notify,
    reload: manager.reload,
    t,
  });
  useEffect(() => {
    void loadAppSettings()
      .then((settings) => {
        setWebProxyPort(settings.webProxyPort ?? null);
        setWebProxyListenOnAllInterfaces(settings.webProxyListenOnAllInterfaces ?? false);
        setNetworkProxy(settings.networkProxy ?? DEFAULT_NETWORK_PROXY);
        setAutoDisableStatusCodes(
          settings.autoDisableStatusCodes ?? [...DEFAULT_AUTO_DISABLE_STATUS_CODES],
        );
        setShowUsageNetworkErrors(settings.showUsageNetworkErrors ?? false);
        setShowCustomCloudServer(settings.showCustomCloudServer ?? false);
        setProviderGroups(settings.providerGroups ?? []);
      })
      .catch((error) => notify(String(error)));
  }, [notify]);
  const saveProviderGroups = useCallback(async (groups: string[]) => {
    try {
      setProviderGroups(await updateProviderGroups(groups));
    } catch (error) {
      notify(String(error));
      throw error;
    }
  }, [notify]);
  const resetCredits = useResetCredits(manager.accounts, notify, t);
  const activeAccount = manager.accounts.find((account) => account.active) ?? null;
  const activeProvider = providerManager.activeProvider;
  const thirdPartySubagentModels = useMemo(() => {
    if (!activeProvider || activeProvider.kind !== "custom") return ["sol", "terra", "luna"];
    return [...new Set([activeProvider.model, ...activeProvider.models].map((model) => model.trim())
      .filter(Boolean))];
  }, [activeProvider]);
  const thirdPartySubagentModel = activeProvider?.kind === "custom"
    && !thirdPartySubagentModels.includes(thirdPartyAppIntegration.settings.claudeSubagentModel)
    ? (thirdPartySubagentModels[0] ?? thirdPartyAppIntegration.settings.claudeSubagentModel)
    : thirdPartyAppIntegration.settings.claudeSubagentModel;
  const concurrentRoutingActive = Boolean(
    providerManager.localProxy?.running
      && providerManager.localProxy.concurrentAccountRoutingEnabled,
  );
  const concurrentAutoRefreshAccountIds = useMemo(
    () => manager.accounts
      .filter((account) => account.autoSwitchEnabled)
      .map((account) => account.id),
    [manager.accounts],
  );
  const configuredBalanceProviders = useMemo(
    () => providerManager.providers.filter((provider) => Boolean(provider.balancePlatform)),
    [providerManager.providers],
  );
  const refreshConfiguredProviderBalances = useCallback(async () => {
    if (!configuredBalanceProviders.length) return;
    providerBalanceRefreshCountRef.current += 1;
    setRefreshingProviderBalances(true);
    try {
      await refreshProviderBalances(configuredBalanceProviders);
    } finally {
      providerBalanceRefreshCountRef.current -= 1;
      if (providerBalanceRefreshCountRef.current === 0) {
        setRefreshingProviderBalances(false);
      }
    }
  }, [configuredBalanceProviders]);
  const refreshCurrentSelection = useCallback(async () => {
    if (concurrentRoutingActive) {
      await manager.refreshAll({ quiet: true, showSpinner: false, enabledOnly: true });
      return;
    }
    const tasks: Promise<unknown>[] = [];
    if (activeProvider?.balancePlatform) {
      tasks.push(queryProviderBalance(activeProvider.id));
    }
    if (activeAccount) {
      tasks.push(manager.refreshUsage(activeAccount.id, true, false));
    }
    await Promise.allSettled(tasks);
  }, [activeAccount, activeProvider, concurrentRoutingActive, manager.refreshAll, manager.refreshUsage]);
  const currentAutoRefreshTargetId = concurrentRoutingActive
    ? concurrentAutoRefreshAccountIds.length
      ? `concurrent:${concurrentAutoRefreshAccountIds.join(",")}`
      : null
    : activeProvider?.balancePlatform
      ? `provider:${activeProvider.id}`
      : activeAccount
        ? `account:${activeAccount.id}`
        : null;
  const currentAutoRefreshTarget = concurrentRoutingActive
    ? concurrentAutoRefreshAccountIds.length
      ? t("settings.accountAutoRefresh.concurrent", { count: concurrentAutoRefreshAccountIds.length })
      : null
    : activeProvider?.balancePlatform
      ? activeProvider.name
      : activeAccount?.email ?? null;
  const refreshTokenCostCurrency = useCallback(async () => {
    if (!loadTokenCostDisplaySettings().currencyCode) return;
    try {
      const rates = await fetchCloudCurrencyRates();
      refreshTokenCostCurrencyRate(rates.currencies);
    } catch {
      // A currency refresh must not interrupt the global usage refresh.
    }
  }, []);
  const automaticRefresh = useCallback(
    async () => {
      await Promise.all([
        manager.refreshAll({ quiet: true, showSpinner: false }),
        refreshConfiguredProviderBalances(),
        refreshTokenCostCurrency(),
        loadAnnouncement(),
        loadNotifications(),
        loadFaqs(),
      ]);
    },
    [
      loadAnnouncement,
      loadFaqs,
      loadNotifications,
      manager.refreshAll,
      refreshConfiguredProviderBalances,
      refreshTokenCostCurrency,
    ],
  );
  const autoRefresh = useAutoRefresh(true, automaticRefresh);
  const accountAutoRefresh = useAccountAutoRefresh(
    currentAutoRefreshTargetId,
    () => refreshCurrentSelection(),
  );
  const openLogin = useCallback(() => setShowLogin(true), []);
  const openCloudLogin = useCallback(() => {
    setCloudSessionExpired(false);
    setShowCloudLogin(true);
  }, []);
  const openCloudAccount = useCallback(() => setShowCloudAccount(true), []);
  const refreshUsage = useCallback((id: string) => {
    void manager.refreshUsage(id);
  }, [manager.refreshUsage]);
  const deleteAccount = useCallback((id: string) => {
    void manager.deleteAccount(id);
  }, [manager.deleteAccount]);
  const setAccountAutoSwitchEnabled = useCallback((id: string, enabled: boolean) => {
    void manager.setAutoSwitchEnabled(id, enabled);
  }, [manager.setAutoSwitchEnabled]);
  const saveAccountNote = useCallback((id: string, details: AccountDetailsDraft) => (
    manager.saveAccountNote(id, details)
  ), [manager.saveAccountNote]);
  const switchProviderModel = useCallback((id: string, model: string) => {
    void providerManager.switchModel(id, model);
  }, [providerManager.switchModel]);
  const setProviderModelControl = useCallback((id: string, controlledByCodex: boolean) => {
    void providerManager.setModelControl(id, controlledByCodex);
  }, [providerManager.setModelControl]);
  const deleteProvider = useCallback((id: string) => {
    void providerManager.deleteProvider(id);
  }, [providerManager.deleteProvider]);
  const loadResetCredits = useCallback((id: string, force?: boolean) => {
    void resetCredits.refreshAccount(id, force);
  }, [resetCredits.refreshAccount]);
  const useResetCredit = useCallback(async (id: string) => {
    setResetCreditBusyAccountId(id);
    try {
      await consumeResetCredit(id);
      notify(t("toast.resetCreditConsumed"));
      await Promise.allSettled([
        resetCredits.refreshAccount(id, true),
        manager.refreshUsage(id, true, false),
      ]);
    } catch (error) {
      notify(String(error));
    } finally {
      setResetCreditBusyAccountId(null);
    }
  }, [manager.refreshUsage, notify, resetCredits.refreshAccount, t]);
  const changeWebProxyPort = useCallback(async (port: number | null) => {
    setWebProxyPortLoading(true);
    try {
      const settings = await updateWebProxyPort(port);
      setWebProxyPort(settings.webProxyPort ?? null);
      setWebProxyListenOnAllInterfaces(settings.webProxyListenOnAllInterfaces ?? false);
      if (!hasLocalBackend) await providerManager.reload();
      notify(t(port === null ? "toast.webServerDisabled" : "toast.webServerStarted", {
        port: port ?? "",
      }));
    } catch (error) {
      notify(String(error));
    } finally {
      setWebProxyPortLoading(false);
    }
  }, [notify, providerManager.reload, t]);

  const changeWebProxyListenOnAllInterfaces = useCallback(async (enabled: boolean) => {
    setWebProxyPortLoading(true);
    try {
      const settings = await updateWebProxyListenOnAllInterfaces(enabled);
      setWebProxyPort(settings.webProxyPort ?? null);
      setWebProxyListenOnAllInterfaces(settings.webProxyListenOnAllInterfaces ?? false);
      notify(t(enabled ? "toast.webServerLanEnabled" : "toast.webServerLanDisabled"));
    } catch (error) {
      notify(String(error));
    } finally {
      setWebProxyPortLoading(false);
    }
  }, [notify, t]);

  const copyWebProxyKey = useCallback(async () => {
    try {
      await copyWebProxyLanApiKey();
      notify(t("providers.proxy.lanApiKeyCopied"));
    } catch (error) {
      notify(String(error));
    }
  }, [notify, t]);

  const saveNetworkProxy = useCallback(async (settings: NetworkProxySettings) => {
    setNetworkProxyLoading(true);
    try {
      const saved = await updateNetworkProxy(settings);
      setNetworkProxy(saved.networkProxy ?? DEFAULT_NETWORK_PROXY);
      notify(t(settings.enabled ? "toast.networkProxyEnabled" : "toast.networkProxyDisabled"));
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setNetworkProxyLoading(false);
    }
  }, [notify, t]);

  const changeAutoDisableStatusCodes = useCallback(async (statusCodes: number[]) => {
    setAutoDisableStatusCodes(statusCodes);
    setAutoDisableStatusCodesLoading(true);
    try {
      const settings = await updateAutoDisableStatusCodes(statusCodes);
      setAutoDisableStatusCodes(
        settings.autoDisableStatusCodes ?? [...DEFAULT_AUTO_DISABLE_STATUS_CODES],
      );
    } catch (error) {
      notify(String(error));
      try {
        const settings = await loadAppSettings();
        setAutoDisableStatusCodes(
          settings.autoDisableStatusCodes ?? [...DEFAULT_AUTO_DISABLE_STATUS_CODES],
        );
      } catch {
        // Keep the last known saved value when settings cannot be reloaded.
      }
    } finally {
      setAutoDisableStatusCodesLoading(false);
    }
  }, [notify]);
  const changeShowUsageNetworkErrors = useCallback(async (enabled: boolean) => {
    setShowUsageNetworkErrors(enabled);
    setShowUsageNetworkErrorsLoading(true);
    try {
      const settings = await updateShowUsageNetworkErrors(enabled);
      setShowUsageNetworkErrors(settings.showUsageNetworkErrors ?? false);
    } catch (error) {
      notify(String(error));
      try {
        const settings = await loadAppSettings();
        setShowUsageNetworkErrors(settings.showUsageNetworkErrors ?? false);
      } catch {
        // Keep the last known saved value when settings cannot be reloaded.
      }
    } finally {
      setShowUsageNetworkErrorsLoading(false);
    }
  }, [notify]);
  const openWebVersion = useCallback((url: string) => {
    if (isDesktopApp) {
      void openUrl(url).catch((error) => notify(String(error)));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, [notify]);
  const changeThemeColor = useCallback((color: string) => {
    void themeColor.setColor(color);
  }, [themeColor.setColor]);
  const saveCloudBaseUrl = useCallback(async (baseUrl: string) => {
    const previousBaseUrl = cloud.state.baseUrl?.trim().replace(/\/+$/, "") ?? "";
    const requestedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (previousBaseUrl && !requestedBaseUrl) {
      await reportBaseUrlChange().catch(() => undefined);
    }
    const nextState = await cloud.saveBaseUrl(baseUrl);
    const nextBaseUrl = nextState.baseUrl?.trim().replace(/\/+$/, "") ?? "";
    if (nextBaseUrl && nextBaseUrl !== previousBaseUrl) {
      void reportBaseUrlChange().catch(() => undefined);
    }
  }, [cloud.saveBaseUrl, cloud.state.baseUrl]);
  const loginCloudAccount = useCallback(async (
    email: string,
    password: string,
    rememberPassword: boolean,
  ) => {
    const ok = await cloud.login(email, password, rememberPassword);
    if (ok) {
      cloudSessionPromptedRef.current = false;
      await Promise.all([manager.reload(), providerManager.reload()]);
    }
    return ok;
  }, [cloud.login, manager.reload, providerManager.reload]);
  const registerCloudAccount = useCallback(async (
    email: string,
    password: string,
    verificationCode: string,
    rememberPassword: boolean,
  ) => {
    const ok = await cloud.register(email, password, verificationCode, rememberPassword);
    if (ok) {
      cloudSessionPromptedRef.current = false;
      await Promise.all([manager.reload(), providerManager.reload()]);
    }
    return ok;
  }, [cloud.register, manager.reload, providerManager.reload]);
  const openCloudPasswordReset = useCallback(() => {
    const baseUrl = (cloud.state.baseUrl?.trim() || DEFAULT_CLOUD_BASE_URL).replace(/\/+$/, "");
    const resetUrl = `${baseUrl}/admin/reset-password`;
    if (isDesktopApp) {
      void openUrl(resetUrl).catch((error) => notify(String(error)));
      return;
    }
    window.open(resetUrl, "_blank", "noopener,noreferrer");
  }, [cloud.state.baseUrl, notify]);
  const syncCloud = useCallback(async () => {
    const result = await cloud.sync();
    if (result) {
      await totpManager.syncCloud();
      await manager.reload();
      await providerManager.reload();
    }
  }, [cloud.sync, manager.reload, providerManager.reload, totpManager.syncCloud]);
  const changeFloatingBubble = useCallback((enabled: boolean) => {
    void floatingBubble.setEnabled(enabled);
  }, [floatingBubble.setEnabled]);
  const changeLaunchAtStartup = useCallback((enabled: boolean) => {
    void launchAtStartup.setEnabled(enabled);
  }, [launchAtStartup.setEnabled]);
  const changeCloseToTray = useCallback((enabled: boolean) => {
    void closeToTray.setEnabled(enabled);
  }, [closeToTray.setEnabled]);
  const changeBubbleResetDisplay = useCallback((display: BubbleResetDisplay) => {
    void bubbleResetDisplay.setDisplay(display);
  }, [bubbleResetDisplay.setDisplay]);
  const changeBubbleStyle = useCallback((style: BubbleStyle) => {
    void bubbleStyle.setStyle(style);
  }, [bubbleStyle.setStyle]);
  const changePrivacyMode = useCallback((enabled: boolean) => {
    void privacyMode.setEnabled(enabled);
  }, [privacyMode.setEnabled]);
  const changeHideAccountNotes = useCallback((enabled: boolean) => {
    void privacyMode.setHideAccountNotes(enabled);
  }, [privacyMode.setHideAccountNotes]);
  const openFolder = useCallback((target: "codexHome" | "accountStore") => {
    if (!hasLocalBackend) {
      notify(t("toast.previewOpenFolder"));
      return;
    }
    void openManagedFolder(target).catch((error) => notify(String(error)));
  }, [notify, t]);
  const openCodexHome = useCallback(() => {
    openFolder("codexHome");
  }, [openFolder]);
  const openAccountStore = useCallback(() => {
    openFolder("accountStore");
  }, [openFolder]);
  const exportLogs = useCallback(async () => {
    notify(isDesktopApp ? t("toast.exportLogsPrompt") : t("toast.previewNoFile"));
    setExportingLogs(true);
    try {
      const result = await chooseAndExportDiagnosticLogs();
      if (result.status === "exported") notify(t("toast.logsExported"));
    } catch (error) {
      notify(String(error));
    } finally {
      setExportingLogs(false);
    }
  }, [notify, t]);
  const openHelp = useCallback(() => {
    setShowHelp(true);
    void loadFaqs();
  }, [loadFaqs]);

  const sendFeedback = useCallback(async (content: string, contactEmail: string | null, images: File[]) => {
    await submitFeedback(content, manager.info?.version ?? "0.1.0", contactEmail, images);
    notify(t("feedback.success"));
  }, [manager.info?.version, notify, t]);

  useCloudContentLifecycle(cloudContent, cloud.state.baseUrl);

  useEffect(() => {
    void reportFirstInstallation().catch(() => undefined);
    void reportDeviceActivity().catch(() => undefined);
  }, [cloud.state.baseUrl]);

  const startLogin = (embedded: boolean) => {
    setShowLogin(false);
    void manager.startLogin(embedded);
  };
  const startWebSessionLogin = () => {
    setShowLogin(false);
    void manager.startWebSessionLogin();
  };
  const importAccountJson = () => {
    setShowLogin(false);
    void manager.importAccountJson();
  };
  const importAccountJsonFromClipboard = () => {
    setShowLogin(false);
    void manager.importAccountJsonFromClipboard();
  };
  const refreshAll = () => {
    void manager.refreshAll();
    void refreshConfiguredProviderBalances();
    void refreshTokenCostCurrency();
    void loadAnnouncement();
    void loadNotifications();
    void loadFaqs();
  };
  const restartChatGptProcess = useCallback(async () => {
    setChatGptOperation("restart");
    try {
      await restartChatGpt();
      notify(hasLocalBackend ? t("toast.chatGptRestarted") : t("toast.previewRestartChatGpt"));
    } catch (error) {
      notify(String(error));
    } finally {
      setChatGptOperation(null);
    }
  }, [notify, t]);
  const launchChatGptProcess = useCallback(async () => {
    setChatGptOperation("start");
    try {
      const started = await launchChatGpt();
      notify(hasLocalBackend
        ? t(started ? "toast.chatGptStarted" : "toast.chatGptAlreadyRunning")
        : t("toast.previewStartChatGpt"));
    } catch (error) {
      notify(String(error));
    } finally {
      setChatGptOperation(null);
    }
  }, [notify, t]);
  const confirmRestartChatGpt = useCallback(() => {
    Modal.confirm({
      title: t("actions.restartChatGptConfirmTitle"),
      content: t("actions.restartChatGptConfirmDescription"),
      okText: t("actions.restartChatGpt"),
      cancelText: t("table.cancel"),
      okButtonProps: { danger: true },
      onOk: restartChatGptProcess,
    });
  }, [restartChatGptProcess, t]);
  const switchAccount = useCallback(async (id: string) => {
    const localProxyRunning = Boolean(providerManager.localProxy?.running);
    await manager.switchAccount(id, localProxyRunning);
  }, [
    manager.switchAccount,
    providerManager.localProxy?.running,
  ]);
  const switchProvider = useCallback(async (id: string) => {
    await providerManager.switchProvider(id);
  }, [providerManager.switchProvider]);
  const switchProviderGroup = useCallback(async (group: string) => {
    await providerManager.switchProviderGroup(group);
  }, [providerManager.switchProviderGroup]);
  const openTokenUsage = useCallback(async () => {
    try {
      await showTokenUsageWindow();
    } catch (error) {
      notify(String(error));
    }
  }, [notify]);
  const openExternalUrl = useCallback((url: string) => {
    if (isDesktopApp) {
      void openUrl(url).catch((error) => notify(String(error)));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, [notify]);
  const openRepository = useCallback(() => {
    openExternalUrl(REPOSITORY_URL);
  }, [openExternalUrl]);
  const downloadAndroidApk = useCallback(async () => {
    const releasePageUrl = `${REPOSITORY_URL}/releases/latest`;
    try {
      const response = await fetch(LATEST_RELEASE_API_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error(response.statusText);
      const release = await response.json() as {
        assets?: Array<{ name?: string; browser_download_url?: string }>;
      };
      const apkUrl = release.assets?.find((asset) => (
        /^CodexSwitch-android-.+\.apk$/i.test(asset.name ?? "")
      ))?.browser_download_url;
      openExternalUrl(apkUrl ?? releasePageUrl);
    } catch {
      openExternalUrl(releasePageUrl);
    }
  }, [openExternalUrl]);
  const openCloudWebVersion = useCallback(() => {
    const baseUrl = (cloud.state.baseUrl?.trim() || DEFAULT_CLOUD_BASE_URL).replace(/\/+$/, "");
    openExternalUrl(`${baseUrl}/web`);
  }, [cloud.state.baseUrl, openExternalUrl]);
  const appUpdate = useAppUpdate(notify, t);
  const {
    availableUpdate, checkAboutVersion, checkForUpdates, downloadingUpdate,
    downloadRequested: installAfterDownloadRequested, downloadUpdate, helpVersionState,
    installingUpdate, installUpdate, setShowUpdatePrompt, showAvailableUpdate, showUpdatePrompt,
    updateDownloaded, updateInstallError, updateProgress,
  } = appUpdate;
  const openAbout = useCallback(() => {
    setShowAbout(true);
    checkAboutVersion();
  }, [checkAboutVersion]);
  const openHelpUpdate = useCallback(() => {
    if (!showAvailableUpdate()) return;
    setShowAbout(false);
    setShowHelp(false);
  }, [showAvailableUpdate]);
  const handleSystemMenuAction = (action: SystemMenuAction) => {
    switch (action) {
      case "add-account":
        openLogin();
        break;
      case "import-archive":
        void manager.importAccountArchive();
        break;
      case "export-archive":
        void manager.exportAccountArchive();
        break;
      case "open-codex-home":
        openCodexHome();
        break;
      case "open-account-store":
        openAccountStore();
        break;
      case "restart-app":
        void restartApplication();
        break;
      case "quit-app":
        void quitApplication();
        break;
      case "navigation-style-top":
      case "navigation-style-sidebar":
        navigationStyle.setStyle(action === "navigation-style-top" ? "top" : "sidebar");
        break;
      case "accounts":
        setPage("accounts");
        break;
      case "providers":
        setPage("providers");
        break;
      case "claude-code":
        setPage("claudeCode");
        break;
      case "token-usage":
        setPage("tokens");
        break;
      case "dream-skin":
        setPage("dreamSkin");
        break;
      case "skills":
        setPage("skills");
        break;
      case "sessions":
        setPage("sessions");
        break;
      case "system-prompt-filter":
        setPage("promptFilter");
        break;
      case "system-prompt-injection":
        setPage("promptInjection");
        break;
      case "settings":
        setPage("settings");
        break;
      case "refresh-all":
        refreshAll();
        break;
      case "refresh-reset-credits":
        void resetCredits.refreshAll();
        break;
      case "open-token-window":
        void openTokenUsage();
        break;
      case "network-proxy":
        setShowNetworkProxy(true);
        break;
      case "start-chatgpt":
        void launchChatGptProcess();
        break;
      case "restart-chatgpt":
        confirmRestartChatGpt();
        break;
      case "export-logs":
        void exportLogs();
        break;
      case "cloud-account":
        if (cloud.state.authenticated) openCloudAccount();
        else openCloudLogin();
        break;
      case "cloud-sync":
        if (cloud.state.authenticated) void syncCloud();
        else openCloudLogin();
        break;
      case "cloud-logout":
        if (cloud.state.authenticated) void cloud.logout();
        break;
      case "notifications": {
        markNotificationsSeen();
        setNotificationsOpen(true);
        break;
      }
      case "help":
        openHelp();
        break;
      case "check-update":
        void checkForUpdates();
        break;
      case "feedback":
        setShowFeedback(true);
        break;
      case "repository":
        openRepository();
        break;
      case "about":
        openAbout();
        break;
    }
  };

  const localizedAnnouncementContent = announcement
    ? (language === "zh" ? announcement.contentZh : announcement.contentEn)?.trim()
      || announcement.content?.trim()
    : "";
  const announcementText = localizedAnnouncementContent || t("announcement.welcome");
  const announcementLink = normalizeHttpUrl(announcement?.link);
  const announcementStyle = announcement ? {
    color: announcement.textColor,
    backgroundColor: announcement.backgroundColor,
  } : undefined;
  const openAnnouncementLink = () => {
    if (!announcementLink) return;
    if (isDesktopApp) {
      void reportAnnouncementClick(announcementLink, announcement?.updatedAt).catch(() => undefined);
      void openUrl(announcementLink).catch((error) => notify(String(error)));
      return;
    }
    window.open(announcementLink, "_blank", "noopener,noreferrer");
  };
  const openExternalLink = (link: string) => {
    const normalized = normalizeHttpUrl(link);
    if (!normalized) return;
    if (isDesktopApp) {
      void openUrl(normalized).catch((error) => notify(String(error)));
      return;
    }
    window.open(normalized, "_blank", "noopener,noreferrer");
  };
  const chatGptActionMenu = (
    <Dropdown
      trigger={["hover"]}
      menu={{
        items: [
          {
            key: "start",
            icon: <Play className={chatGptOperation === "start" ? "spin" : undefined} size={15} />,
            label: t("actions.startChatGpt"),
            disabled: chatGptOperation !== null,
          },
          {
            key: "restart",
            icon: <RotateCcw className={chatGptOperation === "restart" ? "spin" : undefined} size={15} />,
            label: t("actions.restartChatGpt"),
            disabled: chatGptOperation !== null,
          },
        ],
        onClick: ({ key }) => {
          if (key === "start") void launchChatGptProcess();
          if (key === "restart") confirmRestartChatGpt();
        },
      }}
    >
      <button type="button" className="refresh-all chatgpt-menu-button" disabled={chatGptOperation !== null}>
        <Play size={17} />{t("actions.chatGpt")}
      </button>
    </Dropdown>
  );
  const refreshActionMenu = (
    <div className="refresh-all-wrap">
      <Dropdown
        trigger={["hover"]}
        menu={{
          items: [
            {
              key: "usage",
              icon: <RefreshCw
                className={manager.refreshingAll || refreshingProviderBalances ? "spin" : undefined}
                size={15} />,
              label: t("actions.refreshAll"),
              disabled: manager.refreshingAll
                || refreshingProviderBalances
                || (!manager.accounts.length && !configuredBalanceProviders.length),
            },
            {
              key: "resetCredits",
              icon: <CalendarClock className={resetCredits.refreshingAll ? "spin" : undefined} size={15} />,
              label: t("actions.refreshResetCredits"),
              disabled: resetCredits.refreshingAll || !manager.accounts.length,
            },
          ],
          onClick: ({ key }) => {
            if (key === "usage") refreshAll();
            if (key === "resetCredits") void resetCredits.refreshAll();
          },
        }}
      >
        <button type="button" className="refresh-all"
          disabled={!manager.accounts.length && !configuredBalanceProviders.length}>
          <RefreshCw
            className={manager.refreshingAll || refreshingProviderBalances || resetCredits.refreshingAll
              ? "spin" : undefined}
            size={17} />
          {t("actions.refresh")}
        </button>
      </Dropdown>
    </div>
  );
  const menuItems = buildDashboardMenuItems(t, cloud.state.authenticated);
  const windowMenu = (label: string, items: MenuProps["items"], selectedKeys?: string[]) => (
    <Dropdown
      trigger={["click"]}
      placement="bottomLeft"
      overlayClassName="window-menu-dropdown"
      menu={{
        items,
        selectedKeys,
        onClick: ({ key }) => handleSystemMenuAction(key as SystemMenuAction),
      }}
    >
      <button type="button" className="window-menu-trigger">{label}</button>
    </Dropdown>
  );
  const toggleWindowMaximized = () => {
    void getCurrentWindow().toggleMaximize().catch((error) => notify(String(error)));
  };
  const titlebarProxyRunning = Boolean(providerManager.localProxy?.running);
  const proxyStartDisabledReason = !hasLocalBackend && !providerManager.localProxy?.port
    ? t("providers.proxy.webPortRequired")
    : activeAccount && !activeAccount.localProxyCompatible
      ? t("providers.proxy.agentIdentityUnsupported")
      : undefined;
  const proxyStatusControls = (
    <ProxyStatusControls customTitlebarEnabled={CUSTOM_TITLEBAR_ENABLED} manager={providerManager}
      notify={notify} onRequestLanAccess={() => setShowLanAccess(true)}
      startDisabledReason={proxyStartDisabledReason} t={t} />
  );
  const sidebarNavigationEnabled = navigationStyle.style === "sidebar";
  const proxyTopbarActions = (
    <ProxyTopbarActions cloudAuthenticated={cloud.state.authenticated}
      manager={providerManager} showSessionManager={!sidebarNavigationEnabled} t={t} />
  );
  const accountProxyTopbarActions = (
    <ProxyTopbarActions cloudAuthenticated={cloud.state.authenticated}
      manager={providerManager} showSessionManager={!sidebarNavigationEnabled}
      trailingAction={sidebarNavigationEnabled ? undefined : <TotpWindowButton notify={notify} t={t} />} t={t} />
  );
  const menuTools = (
    <DashboardMenuTools actions={{
      checkForUpdates: () => void checkForUpdates(),
      downloadAndroidApk: () => void downloadAndroidApk(),
      openAbout,
      openCloudAccount,
      openCloudLogin,
      openCloudWebVersion,
      openFeedback: () => setShowFeedback(true),
      openHelp,
      openNotificationLink: openExternalLink,
      openRepository,
      openSettings: () => setPage("settings"),
      syncCloud: () => void syncCloud(),
    }} appUpdate={appUpdate} cloud={cloud} cloudContent={cloudContent} language={language}
      onToggleThemeMode={themeMode.toggleMode} t={t} themeMode={themeMode.mode} />
  );
  const sidebarToggleLabel = t(navigationStyle.sidebarCollapsed
    ? "nav.expandSidebar"
    : "nav.collapseSidebar");

  return (
    <ConfigProvider locale={language === "zh" ? zhCN : enUS} theme={{
      algorithm: themeMode.mode === "dark"
        ? [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm]
        : antdTheme.compactAlgorithm,
      token: {
        colorPrimary: themeColor.color,
        borderRadius: 6,
        fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif",
      },
    }}>
      <div className={`app-shell${CUSTOM_TITLEBAR_ENABLED ? " custom-titlebar-shell" : ""}${
        sidebarNavigationEnabled ? " sidebar-navigation-shell" : ""
      }${sidebarNavigationEnabled && navigationStyle.sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        {CUSTOM_TITLEBAR_ENABLED && (
          <header className="window-titlebar">
            <nav className="window-menu-bar" aria-label={t("windowMenu.aria")}>
              {windowMenu(t("windowMenu.file"), menuItems.file)}
              {windowMenu(t("windowMenu.view"), menuItems.view, [
                `navigation-style-${navigationStyle.style}`,
              ])}
              {windowMenu(t("windowMenu.navigate"), menuItems.navigate)}
              {windowMenu(t("windowMenu.tools"), menuItems.tools)}
              {windowMenu(t("windowMenu.cloud"), menuItems.cloud)}
              {windowMenu(t("windowMenu.help"), menuItems.help)}
              <button
                type="button"
                className="window-menu-search-trigger"
                aria-label={`${t("menuSearch.label")} (${t("menuSearch.shortcut")})`}
                title={`${t("menuSearch.label")} (${t("menuSearch.shortcut")})`}
                onClick={() => setShowMenuSearch(true)}
              >
                <Search size={14} />
              </button>
            </nav>
            <div className="window-titlebar-drag-region" data-tauri-drag-region />
            <div className="window-titlebar-tools">
              {proxyStatusControls}
              {menuTools}
            </div>
            <div className="window-controls">
              <button type="button" className="window-control" aria-label={t("windowMenu.minimize")}
                onClick={() => void getCurrentWindow().minimize().catch((error) => notify(String(error)))}>
                <Minus size={16} />
              </button>
              <button type="button" className="window-control" aria-label={t("windowMenu.maximize")}
                onClick={toggleWindowMaximized}>
                <Square size={13} />
              </button>
              <button type="button" className="window-control window-control-close"
                aria-label={t("windowMenu.close")}
                onClick={() => void getCurrentWindow().close().catch((error) => notify(String(error)))}>
                <X size={17} />
              </button>
            </div>
          </header>
        )}
        {sidebarNavigationEnabled && (
          <aside className="app-sidebar">
            <button type="button" className="brand sidebar-brand" onClick={openRepository}
              aria-label={t("help.github")} title={t("help.github")}>
              <img className="brand-logo" src={APP_LOGO_URL} alt="" />
              <span>Codex<br /><b>Switch</b></span>
            </button>
            <DashboardNavigation collapsed={navigationStyle.sidebarCollapsed}
              onPageChange={setPage} page={page} t={t} variant="sidebar"
              sidebarTools={(
                <>
                  {titlebarProxyRunning && <ProxySessionManager t={t} triggerVariant="sidebar" />}
                  <TotpWindowButton notify={notify} t={t} variant="sidebar" />
                </>
              )} />
          </aside>
        )}
        <header className="app-menu">
          {sidebarNavigationEnabled ? (
            <button type="button" className="sidebar-collapse-button" aria-label={sidebarToggleLabel}
              title={sidebarToggleLabel}
              onClick={() => navigationStyle.setSidebarCollapsed(!navigationStyle.sidebarCollapsed)}>
              {navigationStyle.sidebarCollapsed
                ? <PanelLeftOpen size={19} />
                : <PanelLeftClose size={19} />}
            </button>
          ) : (
            <button type="button" className="brand" onClick={openRepository}
              aria-label={t("help.github")} title={t("help.github")}>
              <img className="brand-logo" src={APP_LOGO_URL} alt="" />
              <span>Codex<br /><b>Switch</b></span>
            </button>
          )}
          <AnnouncementBanner link={announcementLink} onOpenLink={openAnnouncementLink}
            scrollDurationSeconds={announcement?.scrollDurationSeconds ?? 22}
            style={announcementStyle} text={announcementText}
            trackKey={`${language}:${announcementText}`} />
          {!sidebarNavigationEnabled && (
            <DashboardNavigation onPageChange={setPage} page={page} t={t} />
          )}
          {!CUSTOM_TITLEBAR_ENABLED && menuTools}
        </header>

        <main className={page === "accounts" ? "accounts-main"
          : page === "providers" ? "providers-main"
          : page === "claudeCode" ? "claude-code-main"
          : page === "tokens" ? "tokens-main"
            : page === "dreamSkin" ? "dream-skin-main"
              : page === "sessions" ? "sessions-main" : undefined}>
          {page !== "tokens" && page !== "dreamSkin" && (
          <>
          <header className={`topbar${page === "accounts" || page === "providers" ? " account-view-topbar" : ""}${
            page === "accounts" && providerManager.localProxy?.running ? " accounts-topbar" : ""
          }${page === "settings" ? " settings-topbar" : ""}`}>
            {page === "accounts" && providerManager.localProxy?.running ? (
              <TokenUsageHeatmap weeks={tokenUsagePreferences.weeks}
                refreshSeconds={tokenUsagePreferences.refreshSeconds} language={language} t={t} />
            ) : (
              <div className={page === "accounts" ? "accounts-heading"
                : page === "skills" ? "skills-market-heading"
                : page === "settings" ? "settings-heading" : undefined}>
                <span className="eyebrow">{dashboardEyebrow(page, t)}</span>
                <div className={page === "skills" ? "skills-market-title-row"
                  : page === "settings" ? "settings-title-row" : undefined}>
                  <h1>{dashboardTitle(page, t, {
                    accountCount: manager.accounts.length,
                    providerCount: providerManager.providers.length,
                  })}</h1>
                  {page === "skills" && <div id="skills-market-tabs" className="skills-market-tabs-slot" />}
                  {page === "settings" && <SettingsGroupsNav t={t} />}
                </div>
              </div>
            )}
            {(page === "accounts" || page === "providers") && (
              <AccountDisplayTabs displayMode={accountDisplayMode.displayMode}
                onChange={accountDisplayMode.setDisplayMode} t={t} />
            )}
            {page === "accounts" && (
              <AccountTopbarActions accounts={manager.accounts}
                providers={providerManager.providers} localProxy={providerManager.localProxy}
                proxyBusy={providerManager.proxyBusy} privacyMode={privacyMode.enabled}
                onImageModelChange={providerManager.setProxyImageModel} t={t}>
                <button className="primary-button" onClick={openLogin}>
                  <Plus size={18} />{t("actions.addAccount")}
                </button>
                {refreshActionMenu}
                {chatGptActionMenu}
                {accountProxyTopbarActions}
              </AccountTopbarActions>
            )}
            {page === "providers" && (
              <div className="topbar-actions">
                <div id="provider-topbar-actions" className="provider-topbar-action-slot" />
                {chatGptActionMenu}
                {proxyTopbarActions}
              </div>
            )}
            {page === "settings" && (
              <div className="topbar-actions">
                <button type="button" className="refresh-all settings-help-button" onClick={openHelp}>
                  <CircleHelp size={17} />{t("help.open")}
                </button>
              </div>
            )}
            {page === "skills" && (
              <div id="skills-market-topbar-actions" className="topbar-actions skills-market-topbar-actions" />
            )}
            {page === "sessions" && <div id="codex-thread-topbar-actions" className="topbar-actions" />}
            {page === "promptInjection" && (
              <div id="system-prompt-injection-topbar-actions" className="topbar-actions" />
            )}
            {page === "claudeCode" && (
              <div id="third-party-apps-topbar-actions"
                className="topbar-actions third-party-apps-topbar-actions" />
            )}
          </header>
          {page === "accounts" && accountDisplayMode.displayMode === "cards" && (
            <div className="account-card-toolbar-row">
              <div id="account-card-topbar-controls" className="account-card-topbar-controls" />
            </div>
          )}
          </>
          )}

          <section className="page-panel" hidden={page !== "dreamSkin"}>
            {page === "dreamSkin" && <MemoDreamSkinPage t={t} notify={notify} />}
          </section>
          <section className="page-panel" hidden={page !== "claudeCode"}>
            {page === "claudeCode" && (
              <MemoThirdPartyAppsPage
                settings={thirdPartyAppIntegration.settings}
                saving={thirdPartyAppIntegration.saving}
                proxyBusy={providerManager.proxyBusy}
                proxyRunning={Boolean(providerManager.localProxy?.running)}
                proxyStartDisabledReason={proxyStartDisabledReason}
                hasProxyTarget={Boolean(activeProvider || activeAccount?.official)}
                busy={thirdPartyAppIntegration.busy}
                onEnabledChange={thirdPartyAppIntegration.changeEnabled}
                onWriteCodexChange={thirdPartyAppIntegration.changeWriteCodex}
                onStartProxy={() => void providerManager.startProxy()}
                onOpenAccounts={() => setPage("accounts")}
                onOpenProviders={() => setPage("providers")}
                onAppChange={thirdPartyAppIntegration.changeApp}
                onSubagentModelChange={thirdPartyAppIntegration.changeSubagentModel}
                subagentModels={thirdPartySubagentModels}
                subagentModel={thirdPartySubagentModel}
                onLaunch={(appId) => void thirdPartyAppIntegration.launch(appId)}
                onRestart={(appId) => void thirdPartyAppIntegration.restart(appId)}
                t={t}
              />
            )}
          </section>
          <section className="page-panel" hidden={page !== "settings"}>
            <MemoSettingsPage info={manager.info} autoRefreshEnabled={autoRefresh.enabled}
              launchAtStartupEnabled={launchAtStartup.enabled}
              launchAtStartupLoading={launchAtStartup.loading}
              onLaunchAtStartupChange={changeLaunchAtStartup}
              closeToTrayEnabled={closeToTray.enabled}
              closeToTrayLoading={closeToTray.loading}
              onCloseToTrayChange={changeCloseToTray}
              autoRefreshSeconds={autoRefresh.seconds} onEnabledChange={autoRefresh.setEnabled}
              onSecondsChange={autoRefresh.updateSeconds}
              currentAutoRefreshTarget={currentAutoRefreshTarget}
              accountAutoRefreshEnabled={accountAutoRefresh.enabled}
              accountAutoRefreshSeconds={accountAutoRefresh.seconds}
              onAccountAutoRefreshEnabledChange={accountAutoRefresh.setEnabled}
              onAccountAutoRefreshSecondsChange={accountAutoRefresh.updateSeconds}
              themeColor={themeColor.color} themeColorLoading={themeColor.loading}
              onThemeColorChange={changeThemeColor}
              cloudBaseUrl={cloud.state.baseUrl ?? ""}
              cloudBaseUrlLoading={cloud.loading}
              cloudAuthenticated={cloud.state.authenticated}
              showCustomCloudServer={showCustomCloudServer}
              onCloudBaseUrlSave={saveCloudBaseUrl}
              totpCloudSyncEnabled={totpManager.cloudSyncEnabled}
              totpCloudSyncLoading={totpManager.syncing}
              onTotpCloudSyncChange={totpManager.setCloudSyncEnabled}
              floatingBubbleEnabled={floatingBubble.enabled}
              floatingBubbleLoading={floatingBubble.loading} onFloatingBubbleChange={changeFloatingBubble}
              bubbleResetDisplay={bubbleResetDisplay.display} bubbleResetDisplayLoading={bubbleResetDisplay.loading}
              onBubbleResetDisplayChange={changeBubbleResetDisplay}
              bubbleStyle={bubbleStyle.style} bubbleStyleLoading={bubbleStyle.loading}
              onBubbleStyleChange={changeBubbleStyle}
              privacyModeEnabled={privacyMode.enabled} privacyModeLoading={privacyMode.loading}
              onPrivacyModeChange={changePrivacyMode}
              hideAccountNotes={privacyMode.hideAccountNotes}
              onHideAccountNotesChange={changeHideAccountNotes}
              accountDisplayMode={accountDisplayMode.displayMode}
              onAccountDisplayModeChange={accountDisplayMode.setDisplayMode}
              navigationStyle={navigationStyle.style}
              onNavigationStyleChange={navigationStyle.setStyle}
              tokenUsageWeeks={tokenUsagePreferences.weeks}
              tokenUsageRefreshSeconds={tokenUsagePreferences.refreshSeconds}
              tokenUsagePreferencesLoading={tokenUsagePreferences.loading}
              upstream429RetryTimeoutSeconds={upstream429RetryTimeout.timeoutSeconds}
              upstream429RetryTimeoutLoading={upstream429RetryTimeout.loading}
              onUpstream429RetryTimeoutChange={upstream429RetryTimeout.update}
              autoDisableStatusCodes={autoDisableStatusCodes}
              autoDisableStatusCodesLoading={autoDisableStatusCodesLoading}
              onAutoDisableStatusCodesChange={changeAutoDisableStatusCodes}
              showUsageNetworkErrors={showUsageNetworkErrors}
              showUsageNetworkErrorsLoading={showUsageNetworkErrorsLoading}
              onShowUsageNetworkErrorsChange={changeShowUsageNetworkErrors}
              webProxyPort={webProxyPort}
              webProxyListenOnAllInterfaces={webProxyListenOnAllInterfaces}
              webProxyPortLoading={webProxyPortLoading}
              onWebProxyPortChange={changeWebProxyPort}
              onWebProxyListenOnAllInterfacesChange={changeWebProxyListenOnAllInterfaces}
              onCopyWebProxyLanApiKey={copyWebProxyKey}
              onOpenWebVersion={openWebVersion}
              networkProxy={networkProxy}
              networkProxyLoading={networkProxyLoading}
              onNetworkProxySave={saveNetworkProxy}
              onTokenUsageWeeksChange={tokenUsagePreferences.updateWeeks}
              onTokenUsageRefreshSecondsChange={tokenUsagePreferences.updateRefreshSeconds}
              codexHomeCustomized={codexHome.customized}
              codexHomeLoading={codexHome.loading}
              onChangeCodexHome={() => void codexHome.change()}
              onResetCodexHome={codexHome.reset}
              onOpenCodexHome={openCodexHome} onOpenAccountStore={openAccountStore} language={language}
              onExportLogs={() => void exportLogs()} exportingLogs={exportingLogs}
              onLanguageChange={setLanguage} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "skills"}>
            <MemoSkillsMarketPage active={page === "skills"} baseUrl={cloud.state.baseUrl}
              authenticated={cloud.state.authenticated} currentUserId={cloud.state.userId}
              onLogin={openCloudLogin} notify={notify} t={t} />
          </section>
          <section className="page-panel sessions-page-panel" hidden={page !== "sessions"}>
            {page === "sessions" && <MemoCodexThreadsPage language={language} notify={notify} />}
          </section>
          <section className="page-panel" hidden={page !== "promptFilter"}>
            {page === "promptFilter" && (
              <MemoSystemPromptFilterPage
                enabled={providerManager.localProxy?.systemPromptFilterEnabled ?? false}
                loading={providerManager.proxyBusy}
                onEnabledChange={(enabled) => void providerManager.setSystemPromptFilter(enabled)}
                onRulesChange={providerManager.saveSystemPromptFilterRules}
                proxyRunning={providerManager.localProxy?.running ?? false}
                rules={providerManager.localProxy?.systemPromptFilterRules ?? []}
                t={t}
              />
            )}
          </section>
          <section className="page-panel" hidden={page !== "promptInjection"}>
            {page === "promptInjection" && (
              <MemoSystemPromptInjectionPage
                enabled={providerManager.localProxy?.systemPromptInjectionEnabled ?? false}
                loading={providerManager.proxyBusy}
                onEnabledChange={(enabled) => void providerManager.setSystemPromptInjection(enabled)}
                onPromptsChange={providerManager.saveSystemPromptInjectionPrompts}
                prompts={providerManager.localProxy?.systemPromptInjectionPrompts ?? []}
                t={t}
              />
            )}
          </section>
          <section className="page-panel providers-page-panel" hidden={page !== "providers"}>
            <MemoProvidersPage providers={providerManager.providers}
              aggregateApis={providerManager.aggregateApis} providerGroups={providerGroups}
              accounts={manager.accounts}
              active={page === "providers"}
              loading={providerManager.loading}
              busyProviderId={providerManager.busyProviderId} saving={providerManager.saving}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              proxyStartDisabledReason={proxyStartDisabledReason}
              onStartProxy={() => void providerManager.startProxy()}
              onSave={providerManager.saveProvider}
              onSaveAggregateApi={providerManager.saveAggregateApi}
              onRefreshAggregateApis={providerManager.refreshAggregateApis}
              onSwitchAggregateApi={providerManager.switchAggregateApi}
              onDeleteAggregateApi={providerManager.deleteAggregateApi}
              onSwitch={switchProvider} onDeactivate={providerManager.cancelProviderUse}
              onSwitchGroup={switchProviderGroup}
              onSwitchModel={switchProviderModel}
              onModelControlChange={setProviderModelControl}
              onGroupChange={providerManager.changeProviderGroup}
              onGroupChangeMany={providerManager.changeProviderGroups}
              onProviderGroupsChange={saveProviderGroups}
              onAutoSwitchChange={providerManager.setProviderAutoSwitch}
              onDelete={deleteProvider}
              onDeleteMany={providerManager.deleteProviders}
              onImageModelChange={providerManager.setProxyImageModel}
              displayMode={accountDisplayMode.displayMode}
              privacyMode={privacyMode.enabled}
              tokenUsageRefreshSeconds={tokenUsagePreferences.refreshSeconds}
              language={language} t={t} />
          </section>
          <section className="page-panel token-dashboard-page" hidden={page !== "tokens"}>
            <TokenUsageDashboard dark={themeMode.mode === "dark"} language={language}
              themeColor={themeColor.color}
              weeks={tokenUsagePreferences.weeks}
              refreshSeconds={tokenUsagePreferences.refreshSeconds}
              onWeeksChange={tokenUsagePreferences.updateWeeks}
              preferencesLoading={tokenUsagePreferences.loading} embedded />
          </section>
          <section className="page-panel accounts-page-panel" hidden={page !== "accounts"}>
            <MemoAccountsPage active={page === "accounts"}
              accounts={manager.accounts}
              providers={providerManager.providers}
              loading={manager.loading}
              busyAccountId={manager.busyAccountId} onAdd={openLogin}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              onSwitch={switchAccount}
              onDeactivate={(id) => void manager.deactivateAccount(id)}
              onCopyAuthJson={manager.copyAuthJson}
              onRefresh={refreshUsage}
              onDelete={deleteAccount}
              onConsumeQuotaMany={manager.consumeAccountsQuota}
              onDeleteMany={manager.deleteAccounts}
              onEnableMany={manager.enableAutoSwitchAccounts}
              onDisableMany={manager.disableAutoSwitchAccounts}
              onAutoSwitchEnabledChange={setAccountAutoSwitchEnabled}
              autoSwitchBusyAccountId={manager.autoSwitchBusyAccountId}
              onAutoSwitchPriorityChange={manager.setAutoSwitchPriority}
              autoSwitchPriorityBusyAccountId={manager.autoSwitchPriorityBusyAccountId}
              onAutoSwitchThresholdChange={manager.setAutoSwitchThreshold}
              autoSwitchThresholdBusyAccountId={manager.autoSwitchThresholdBusyAccountId}
              onGlobalAutoSwitchThresholdChange={providerManager.setProxyGlobalThreshold}
              onSaveNote={saveAccountNote}
              onLoadAccountDetails={manager.refreshAccountDetails}
              resetCredits={resetCredits.states}
              onLoadResetCredits={loadResetCredits}
              onUseResetCredit={(id) => void useResetCredit(id)}
              resetCreditBusyAccountId={resetCreditBusyAccountId}
              onOpenaiAuthAccountChange={providerManager.setProxyOpenaiAuthAccount}
              onConcurrentRoutingChange={providerManager.setProxyConcurrentRouting}
              privacyMode={privacyMode.enabled}
              hideAccountNotes={privacyMode.hideAccountNotes}
              showUsageNetworkErrors={showUsageNetworkErrors}
              displayMode={accountDisplayMode.displayMode}
              tokenUsageRefreshSeconds={tokenUsagePreferences.refreshSeconds}
              proxyControls={!CUSTOM_TITLEBAR_ENABLED ? proxyStatusControls : undefined}
              language={language} t={t} />
          </section>
        </main>

        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onWebSession={startWebSessionLogin}
          onStart={startLogin}
          onImport={importAccountJson} onImportClipboard={importAccountJsonFromClipboard} t={t} />}
        {showMenuSearch && <MenuSearchModal items={menuItems.search} onClose={() => setShowMenuSearch(false)}
          onSelect={(action) => {
            setShowMenuSearch(false);
            handleSystemMenuAction(action as SystemMenuAction);
          }} t={t} />}
        {showCloudLogin && <CloudLoginModal loading={cloud.loading} onClose={() => {
          setShowCloudLogin(false);
          setCloudSessionExpired(false);
        }}
          sendingRegistrationCode={cloud.sendingRegistrationCode} onLogin={loginCloudAccount}
          onForgotPassword={openCloudPasswordReset} onRegister={registerCloudAccount}
          onSendRegistrationCode={cloud.sendRegistrationCode} sessionExpired={cloudSessionExpired} t={t} />}
        {showCloudAccount && cloud.state.authenticated && <CloudAccountModal
          email={cloud.state.userEmail} baseUrl={cloud.state.baseUrl}
          changingPassword={cloud.changingPassword} onChangePassword={cloud.changePassword}
          onClose={() => setShowCloudAccount(false)} onOpenPasswordReset={() => {
            setShowCloudAccount(false);
            openCloudPasswordReset();
          }} t={t} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} faq={faqs.map((item) => ({
            id: item.id,
            question: language === "zh" ? item.questionZh : item.questionEn,
            answer: language === "zh" ? item.answerZh : item.answerEn,
          }))} t={t} />}
        {showAbout && <AboutModal logoUrl={APP_LOGO_URL} onClose={() => setShowAbout(false)}
          onOpenRepository={openRepository} onUpdate={openHelpUpdate}
          onFeedback={() => setShowFeedback(true)} version={manager.info?.version ?? "0.1.0"}
          versionState={helpVersionState} t={t} />}
        {showFeedback && <FeedbackModal signedInEmail={cloud.state.authenticated ? cloud.state.userEmail : null}
          onClose={() => setShowFeedback(false)} onSubmit={sendFeedback} t={t} />}
        {availableUpdate && showUpdatePrompt && <UpdateModal update={availableUpdate}
          onClose={() => setShowUpdatePrompt(false)}
          onDownload={() => void downloadUpdate(availableUpdate, true)}
          onInstall={() => void installUpdate()} downloading={downloadingUpdate}
          downloadRequested={installAfterDownloadRequested} downloaded={updateDownloaded}
          installing={installingUpdate} progress={updateProgress} error={updateInstallError} t={t} />}
        <LanAccessModal open={showLanAccess}
          hasConfiguredKey={providerManager.localProxy?.hasLanApiKey ?? false}
          loading={providerManager.proxyBusy}
          onClose={() => setShowLanAccess(false)}
          onConfirm={(apiKey) => providerManager.setProxyListenOnAllInterfaces(true, apiKey)}
          t={t} />
        <NetworkProxySettingsModal open={showNetworkProxy} value={networkProxy}
          loading={networkProxyLoading} onSave={saveNetworkProxy}
          onClose={() => setShowNetworkProxy(false)} t={t} />
        <CcSwitchImportModal request={ccSwitchImport.request} saving={ccSwitchImport.saving}
          onCancel={() => void ccSwitchImport.cancel()}
          onConfirm={(name) => void ccSwitchImport.confirm(name)} t={t} />
        <ProxyProgressModal progress={providerManager.proxyStartProgress}
          phaseKeys={PROXY_START_PHASE_KEYS} titleKey="providers.proxy.startProgressTitle"
          fileLabelKey="providers.proxy.startProgressFiles"
          hintKey="providers.proxy.startProgressHint" t={t} />
        <ProxyProgressModal progress={providerManager.proxyStopProgress}
          phaseKeys={PROXY_STOP_PHASE_KEYS} titleKey="providers.proxy.stopProgressTitle"
          fileLabelKey="providers.proxy.stopProgressFiles"
          hintKey="providers.proxy.stopProgressHint" t={t} />
        {toast && <div className="toast"><Check size={17} />{toast}</div>}
      </div>
    </ConfigProvider>
  );
}
