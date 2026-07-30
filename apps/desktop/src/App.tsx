import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ConfigProvider, Dropdown, Modal, Popconfirm, Popover, Switch, Tooltip, theme as antdTheme, type MenuProps } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { Archive, BarChart3, Bell, CalendarClock, Check, ChevronDown, CircleHelp, Cloud, Copy, Download, Github, LogIn, LogOut, Megaphone, MessageSquareText, Minus, PackageOpen, Palette, Play, Plus, RefreshCw, RotateCcw, Search, Server, Settings, ShieldCheck, Shuffle, Square, Upload, UploadCloud, UserRound, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkForUpdate, chooseAndExportDiagnosticLogs, consumeResetCredit, DEFAULT_CLOUD_BASE_URL, downloadAvailableUpdate, fetchCloudAnnouncement, fetchCloudFaqs, fetchCloudNotifications, installDownloadedUpdate, isDesktopApp, launchChatGpt, loadAppSettings, openManagedFolder, queryProviderBalance, quitApplication, reportAnnouncementClick, reportBaseUrlChange, reportDeviceActivity, reportFirstInstallation, restartApplication, restartChatGpt, showTokenUsageWindow, submitFeedback, subscribeToCloudSessionExpired, updateWebProxyPort } from "./api/backend";
import { AboutModal } from "./components/modals/AboutModal";
import { HelpModal, type HelpVersionState } from "./components/modals/HelpModal";
import { FeedbackModal } from "./components/modals/FeedbackModal";
import { FloatingUsageBubble } from "./components/FloatingUsageBubble";
import { TokenUsageHeatmap } from "./components/TokenUsageHeatmap";
import { TokenUsageDashboard } from "./components/TokenUsageDashboard";
import { TokenUsageWindow } from "./components/TokenUsageWindow";
import { CloudLoginModal } from "./components/modals/CloudLoginModal";
import { CloudAccountModal } from "./components/modals/CloudAccountModal";
import { LoginModal } from "./components/modals/LoginModal";
import { UpdateModal } from "./components/modals/UpdateModal";
import { MenuSearchModal, type MenuSearchItem } from "./components/MenuSearchModal";
import { ProxySessionManager } from "./components/ProxySessionManager";
import { useAccountManager } from "./hooks/useAccountManager";
import { useAccountAutoRefresh, useAutoRefresh } from "./hooks/useAutoRefresh";
import { useAccountDisplayMode } from "./hooks/useAccountDisplayMode";
import { useBubbleResetDisplay } from "./hooks/useBubbleResetDisplay";
import { useBubbleStyle } from "./hooks/useBubbleStyle";
import { useCloudAuth } from "./hooks/useCloudAuth";
import { useLanguage } from "./hooks/useLanguage";
import { useFloatingBubble } from "./hooks/useFloatingBubble";
import { useProviderManager } from "./hooks/useProviderManager";
import { usePrivacyMode } from "./hooks/usePrivacyMode";
import { useResetCredits } from "./hooks/useResetCredits";
import { useThemeColor } from "./hooks/useThemeColor";
import { useTokenUsagePreferences } from "./hooks/useTokenUsagePreferences";
import { useToast } from "./hooks/useToast";
import { AccountsPage } from "./pages/AccountsPage";
import { DreamSkinPage } from "./pages/DreamSkinPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsMarketPage } from "./pages/SkillsMarketPage";
import { formatRefreshTime } from "./utils/format";
import type { BubbleResetDisplay, BubbleStyle, CloudAnnouncement, CloudFaq, CloudNotification, Provider, UpdateInfo } from "./types";

const LAST_REFRESH_ALL_KEY = "codex-switch:last-refresh-all-at";
const LAST_NOTIFICATION_SEEN_KEY = "codex-switch:last-notification-seen-at";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REPOSITORY_URL = "https://github.com/piperhex/codex-switch";
const APP_LOGO_URL = new URL("../src-tauri/icons/128x128.png", import.meta.url).href;
const CUSTOM_TITLEBAR_ENABLED = isDesktopApp && navigator.userAgent.includes("Windows");
const MemoAccountsPage = memo(AccountsPage);
const MemoDreamSkinPage = memo(DreamSkinPage);
const MemoProvidersPage = memo(ProvidersPage);
const MemoSettingsPage = memo(SettingsPage);
const MemoSkillsMarketPage = memo(SkillsMarketPage);

type SystemMenuAction =
  | "add-account"
  | "import-archive"
  | "export-archive"
  | "open-codex-home"
  | "open-account-store"
  | "restart-app"
  | "quit-app"
  | "accounts"
  | "providers"
  | "token-usage"
  | "dream-skin"
  | "skills"
  | "settings"
  | "refresh-all"
  | "refresh-reset-credits"
  | "open-token-window"
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

function storedRefreshAllTime() {
  const value = window.localStorage.getItem(LAST_REFRESH_ALL_KEY);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

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

function DashboardApp() {
  const [page, setPage] = useState<"accounts" | "providers" | "tokens" | "dreamSkin" | "skills" | "settings">("accounts");
  const [showLogin, setShowLogin] = useState(false);
  const [showCloudLogin, setShowCloudLogin] = useState(false);
  const [cloudSessionExpired, setCloudSessionExpired] = useState(false);
  const [showCloudAccount, setShowCloudAccount] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMenuSearch, setShowMenuSearch] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [helpVersionState, setHelpVersionState] = useState<HelpVersionState>({ status: "checking" });
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [installAfterDownloadRequested, setInstallAfterDownloadRequested] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
  const [lastRefreshAllAt, setLastRefreshAllAt] = useState<string | null>(storedRefreshAllTime);
  const [chatGptOperation, setChatGptOperation] = useState<"start" | "restart" | null>(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [resetCreditBusyAccountId, setResetCreditBusyAccountId] = useState<string | null>(null);
  const [refreshingProviderBalances, setRefreshingProviderBalances] = useState(false);
  const [webProxyPort, setWebProxyPort] = useState<number | null>(null);
  const [webProxyPortLoading, setWebProxyPortLoading] = useState(false);
  const [announcement, setAnnouncement] = useState<CloudAnnouncement | null>(null);
  const [notifications, setNotifications] = useState<CloudNotification[]>([]);
  const [faqs, setFaqs] = useState<CloudFaq[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [lastNotificationSeenAt, setLastNotificationSeenAt] = useState(
    () => window.localStorage.getItem(LAST_NOTIFICATION_SEEN_KEY),
  );
  const helpVersionRequestId = useRef(0);
  const announcementRequestId = useRef(0);
  const notificationRequestId = useRef(0);
  const faqRequestId = useRef(0);
  const availableUpdateRef = useRef<UpdateInfo | null>(null);
  const downloadingUpdateRef = useRef(false);
  const updateDownloadedRef = useRef(false);
  const downloadedUpdateUserInitiatedRef = useRef(false);
  const installAfterDownloadRequestedRef = useRef(false);
  const cloudSessionPromptedRef = useRef(false);
  const providerBalanceRefreshCountRef = useRef(0);
  const { message: toast, notify } = useToast();
  const { language, setLanguage, t } = useLanguage();
  const cloud = useCloudAuth(notify, t);
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
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || event.key.toLocaleLowerCase() !== "c") {
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
    deleteAccount: cloud.deleteAccountQuietly,
  }), [cloud.deleteAccountQuietly, cloud.pushAccountQuietly, cloud.pushQuietly]);
  const providerCloudSync = useMemo(() => ({
    pushProvider: cloud.pushProviderQuietly,
    deleteProvider: cloud.deleteProviderQuietly,
  }), [cloud.deleteProviderQuietly, cloud.pushProviderQuietly]);
  const floatingBubble = useFloatingBubble(notify);
  const bubbleResetDisplay = useBubbleResetDisplay(notify);
  const bubbleStyle = useBubbleStyle(notify);
  const privacyMode = usePrivacyMode(notify);
  const accountDisplayMode = useAccountDisplayMode();
  const themeColor = useThemeColor(notify);
  const tokenUsagePreferences = useTokenUsagePreferences(notify);
  const manager = useAccountManager(notify, t, accountCloudSync);
  const providerManager = useProviderManager(notify, t, providerCloudSync);
  useEffect(() => {
    if (isDesktopApp) return;
    void loadAppSettings()
      .then((settings) => setWebProxyPort(settings.webProxyPort ?? null))
      .catch((error) => notify(String(error)));
  }, [notify]);
  const resetCredits = useResetCredits(manager.accounts, notify, t);
  const activeAccount = manager.accounts.find((account) => account.active) ?? null;
  const activeProvider = providerManager.activeProvider;
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
    const tasks: Promise<unknown>[] = [];
    if (activeProvider?.balancePlatform) {
      tasks.push(queryProviderBalance(activeProvider.id));
    }
    if (activeAccount) {
      tasks.push(manager.refreshUsage(activeAccount.id, true, false));
    }
    await Promise.allSettled(tasks);
  }, [activeAccount, activeProvider, manager.refreshUsage]);
  const currentAutoRefreshTargetId = activeProvider?.balancePlatform
    ? `provider:${activeProvider.id}`
    : activeAccount
      ? `account:${activeAccount.id}`
      : null;
  const currentAutoRefreshTarget = activeProvider?.balancePlatform
    ? activeProvider.name
    : activeAccount?.email ?? null;
  const loadAnnouncement = useCallback(async () => {
    const requestId = ++announcementRequestId.current;
    try {
      const result = await fetchCloudAnnouncement();
      if (announcementRequestId.current === requestId) {
        const hasChineseContent = result.contentZh?.trim() || result.content?.trim();
        const hasEnglishContent = result.contentEn?.trim() || result.content?.trim();
        setAnnouncement(result.enabled && hasChineseContent && hasEnglishContent ? result : null);
      }
    } catch {
      if (announcementRequestId.current === requestId) setAnnouncement(null);
    }
  }, []);
  const loadNotifications = useCallback(async () => {
    const requestId = ++notificationRequestId.current;
    try {
      const result = await fetchCloudNotifications();
      if (notificationRequestId.current === requestId) setNotifications(result);
    } catch {
      // Keep the last successful result during a transient server failure.
    }
  }, []);
  const loadFaqs = useCallback(async () => {
    const requestId = ++faqRequestId.current;
    try {
      const result = await fetchCloudFaqs();
      if (faqRequestId.current === requestId) setFaqs(result);
    } catch {
      // Keep the last successful result during a transient server failure.
    }
  }, []);
  const markRefreshAll = useCallback(() => {
    const refreshedAt = new Date().toISOString();
    window.localStorage.setItem(LAST_REFRESH_ALL_KEY, refreshedAt);
    setLastRefreshAllAt(refreshedAt);
  }, []);
  const automaticRefresh = useCallback(
    async () => {
      markRefreshAll();
      await Promise.all([
        manager.refreshAll({ quiet: true, showSpinner: false }),
        refreshConfiguredProviderBalances(),
        loadAnnouncement(),
        loadNotifications(),
        loadFaqs(),
      ]);
    },
    [loadAnnouncement, loadFaqs, loadNotifications, manager.refreshAll, markRefreshAll, refreshConfiguredProviderBalances],
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
  const switchAccount = useCallback((id: string) => {
    void manager.switchAccount(id);
  }, [manager.switchAccount]);
  const refreshUsage = useCallback((id: string) => {
    void manager.refreshUsage(id);
  }, [manager.refreshUsage]);
  const deleteAccount = useCallback((id: string) => {
    void manager.deleteAccount(id);
  }, [manager.deleteAccount]);
  const setAccountAutoSwitchEnabled = useCallback((id: string, enabled: boolean) => {
    void manager.setAutoSwitchEnabled(id, enabled);
  }, [manager.setAutoSwitchEnabled]);
  const saveAccountNote = useCallback((id: string, note: string, expiresAt: string) => (
    manager.saveAccountNote(id, note, expiresAt)
  ), [manager.saveAccountNote]);
  const switchProvider = useCallback((id: string) => {
    void providerManager.switchProvider(id);
  }, [providerManager.switchProvider]);
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
    if (isDesktopApp) return;
    setWebProxyPortLoading(true);
    try {
      const settings = await updateWebProxyPort(port);
      setWebProxyPort(settings.webProxyPort ?? null);
      await providerManager.reload();
    } catch (error) {
      notify(String(error));
    } finally {
      setWebProxyPortLoading(false);
    }
  }, [notify, providerManager.reload]);
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
      await manager.reload();
      await providerManager.reload();
    }
  }, [cloud.sync, manager.reload, providerManager.reload]);
  const changeFloatingBubble = useCallback((enabled: boolean) => {
    void floatingBubble.setEnabled(enabled);
  }, [floatingBubble.setEnabled]);
  const changeBubbleResetDisplay = useCallback((display: BubbleResetDisplay) => {
    void bubbleResetDisplay.setDisplay(display);
  }, [bubbleResetDisplay.setDisplay]);
  const changeBubbleStyle = useCallback((style: BubbleStyle) => {
    void bubbleStyle.setStyle(style);
  }, [bubbleStyle.setStyle]);
  const changePrivacyMode = useCallback((enabled: boolean) => {
    void privacyMode.setEnabled(enabled);
  }, [privacyMode.setEnabled]);
  const openFolder = useCallback((target: "codexHome" | "accountStore") => {
    if (!isDesktopApp) {
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
    const requestId = ++helpVersionRequestId.current;
    setShowHelp(true);
    void loadFaqs();
    setHelpVersionState({ status: "checking" });
    void checkForUpdate({ force: true })
      .then((update) => {
        if (helpVersionRequestId.current !== requestId) return;
        if (update) {
          setAvailableUpdate(update);
          availableUpdateRef.current = update;
          setHelpVersionState({ status: "available", latestVersion: update.latestVersion });
        } else {
          setHelpVersionState({ status: "latest" });
        }
      })
      .catch(() => {
        if (helpVersionRequestId.current === requestId) setHelpVersionState({ status: "error" });
      });
  }, [loadFaqs]);

  const sendFeedback = useCallback(async (content: string, contactEmail: string | null, images: File[]) => {
    await submitFeedback(content, manager.info?.version ?? "0.1.0", contactEmail, images);
    notify(t("feedback.success"));
  }, [manager.info?.version, notify, t]);

  useEffect(() => {
    setAnnouncement(null);
    setNotifications([]);
    setFaqs([]);
    void loadAnnouncement();
    void loadNotifications();
    void loadFaqs();
    const timer = window.setInterval(() => void loadAnnouncement(), 60 * 60 * 1000);
    return () => {
      announcementRequestId.current += 1;
      notificationRequestId.current += 1;
      faqRequestId.current += 1;
      window.clearInterval(timer);
    };
  }, [cloud.state.baseUrl, loadAnnouncement, loadFaqs, loadNotifications]);

  useEffect(() => {
    void reportFirstInstallation().catch(() => undefined);
    void reportDeviceActivity().catch(() => undefined);
  }, [cloud.state.baseUrl]);

  const startLogin = (embedded: boolean) => {
    setShowLogin(false);
    void manager.startLogin(embedded);
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
    markRefreshAll();
    void manager.refreshAll();
    void refreshConfiguredProviderBalances();
    void loadAnnouncement();
    void loadNotifications();
    void loadFaqs();
  };
  const restartChatGptProcess = useCallback(async () => {
    setChatGptOperation("restart");
    try {
      await restartChatGpt();
      notify(isDesktopApp ? t("toast.chatGptRestarted") : t("toast.previewRestartChatGpt"));
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
      notify(isDesktopApp
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
  const openTokenUsage = useCallback(async () => {
    try {
      await showTokenUsageWindow();
    } catch (error) {
      notify(String(error));
    }
  }, [notify]);
  const openRepository = () => {
    if ("__TAURI_INTERNALS__" in window) {
      void openUrl(REPOSITORY_URL).catch((error) => notify(String(error)));
      return;
    }
    window.open(REPOSITORY_URL, "_blank", "noopener,noreferrer");
  };
  const downloadUpdate = useCallback(async (update: UpdateInfo, promptWhenReady: boolean) => {
    if (promptWhenReady) {
      installAfterDownloadRequestedRef.current = true;
      downloadedUpdateUserInitiatedRef.current = true;
      setInstallAfterDownloadRequested(true);
      setAvailableUpdate(update);
      availableUpdateRef.current = update;
    } else if (!downloadingUpdateRef.current) {
      downloadedUpdateUserInitiatedRef.current = false;
    }
    downloadingUpdateRef.current = true;
    setDownloadingUpdate(true);
    setUpdateProgress(null);
    setUpdateInstallError(null);
    try {
      await downloadAvailableUpdate(setUpdateProgress);
      setAvailableUpdate(update);
      availableUpdateRef.current = update;
      setUpdateDownloaded(true);
      updateDownloadedRef.current = true;
      if (installAfterDownloadRequestedRef.current) {
        installAfterDownloadRequestedRef.current = false;
        setInstallAfterDownloadRequested(false);
        setShowUpdatePrompt(true);
      }
      return true;
    } catch (error) {
      downloadedUpdateUserInitiatedRef.current = false;
      if (installAfterDownloadRequestedRef.current) {
        installAfterDownloadRequestedRef.current = false;
        setInstallAfterDownloadRequested(false);
        setUpdateInstallError(String(error));
        setShowUpdatePrompt(true);
      }
      return false;
    } finally {
      downloadingUpdateRef.current = false;
      setDownloadingUpdate(false);
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    setCheckingForUpdate(true);
    setUpdateInstallError(null);
    try {
      const update = await checkForUpdate({ force: true });
      if (update) {
        setAvailableUpdate(update);
        availableUpdateRef.current = update;
        setShowUpdatePrompt(true);
      } else {
        notify(t("update.latest"));
      }
    } catch (error) {
      notify(t("update.checkError", { error: String(error) }));
    } finally {
      setCheckingForUpdate(false);
    }
  }, [notify, t]);

  useEffect(() => {
    let cancelled = false;
    const checkAndDownload = async () => {
      try {
        if (downloadingUpdateRef.current || downloadedUpdateUserInitiatedRef.current) return;
        const replacePending = updateDownloadedRef.current;
        const previousVersion = availableUpdateRef.current?.latestVersion;
        const update = await checkForUpdate({ force: true, replacePending });
        if (!update) return;
        if (replacePending && update.latestVersion === previousVersion) return;
        if (replacePending) {
          updateDownloadedRef.current = false;
          setUpdateDownloaded(false);
        }
        if (!cancelled) await downloadUpdate(update, false);
      } catch {
        // Background update checks retry quietly on the next interval.
      }
    };
    void checkAndDownload();
    const timer = window.setInterval(() => void checkAndDownload(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [downloadUpdate]);

  const installUpdate = useCallback(async () => {
    downloadedUpdateUserInitiatedRef.current = true;
    setInstallingUpdate(true);
    setUpdateInstallError(null);
    try {
      await installDownloadedUpdate();
    } catch (error) {
      setUpdateInstallError(String(error));
      setInstallingUpdate(false);
    }
  }, []);
  const openAbout = useCallback(() => {
    const requestId = ++helpVersionRequestId.current;
    setShowAbout(true);
    setHelpVersionState({ status: "checking" });
    void checkForUpdate({ force: true })
      .then((update) => {
        if (helpVersionRequestId.current !== requestId) return;
        if (update) {
          setAvailableUpdate(update);
          availableUpdateRef.current = update;
          setHelpVersionState({ status: "available", latestVersion: update.latestVersion });
        } else {
          setHelpVersionState({ status: "latest" });
        }
      })
      .catch(() => {
        if (helpVersionRequestId.current === requestId) setHelpVersionState({ status: "error" });
      });
  }, []);
  const openHelpUpdate = useCallback(() => {
    if (!availableUpdateRef.current) return;
    setUpdateInstallError(null);
    setShowAbout(false);
    setShowHelp(false);
    setShowUpdatePrompt(true);
  }, []);
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
      case "accounts":
        setPage("accounts");
        break;
      case "providers":
        setPage("providers");
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
        const seenAt = new Date().toISOString();
        window.localStorage.setItem(LAST_NOTIFICATION_SEEN_KEY, seenAt);
        setLastNotificationSeenAt(seenAt);
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
  const announcementTrack = (
    <div
      className="announcement-track"
      key={`${language}:${announcementText}`}
      style={{ animationDuration: `${announcement?.scrollDurationSeconds ?? 22}s` }}
    >
      <div className="announcement-copy">
        <Megaphone size={15} />
        <span>{announcementText}</span>
      </div>
      <div className="announcement-copy" aria-hidden="true">
        <Megaphone size={15} />
        <span>{announcementText}</span>
      </div>
    </div>
  );
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
  const unreadNotificationCount = notifications.filter((notification) => {
    if (!lastNotificationSeenAt) return true;
    return new Date(notification.updatedAt).getTime() > new Date(lastNotificationSeenAt).getTime();
  }).length;
  const notificationPanel = (
    <section className="notification-panel" aria-label={t("notification.title")}>
      <div className="notification-panel-header">
        <strong>{t("notification.title")}</strong>
        <span>{t("notification.count", { count: notifications.length })}</span>
      </div>
      <div className="notification-list">
        {notifications.length ? notifications.map((notification) => {
          const title = language === "zh" ? notification.titleZh : notification.titleEn;
          const content = language === "zh" ? notification.contentZh : notification.contentEn;
          const linkLabel = (language === "zh"
            ? notification.linkLabelZh
            : notification.linkLabelEn).trim() || t("notification.learnMore");
          return (
            <article className="notification-item" key={notification.id}>
              <div className="notification-item-heading">
                <strong>{title}</strong>
                <time dateTime={notification.publishedAt}>
                  {new Date(notification.publishedAt).toLocaleString(
                    language === "zh" ? "zh-CN" : "en-US",
                    { dateStyle: "medium", timeStyle: "short" },
                  )}
                </time>
              </div>
              <p>{content}</p>
              {normalizeHttpUrl(notification.link) && (
                <button type="button" onClick={() => openExternalLink(notification.link)}>
                  {linkLabel}
                </button>
              )}
            </article>
          );
        }) : <div className="notification-empty">{t("notification.empty")}</div>}
      </div>
    </section>
  );
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
  const backupActionMenu = (
    <Dropdown
      trigger={["hover"]}
      menu={{
        items: [
          {
            key: "import",
            icon: <Upload className={manager.archiveOperation === "import" ? "spin" : undefined} size={15} />,
            label: t("actions.importArchive"),
            disabled: manager.archiveOperation !== null,
          },
          {
            key: "export",
            icon: <Download className={manager.archiveOperation === "export" ? "spin" : undefined} size={15} />,
            label: t("actions.exportArchive"),
            disabled: manager.archiveOperation !== null
              || (!manager.accounts.length && !providerManager.providers.length),
          },
        ],
        onClick: ({ key }) => {
          if (key === "import") void manager.importAccountArchive();
          if (key === "export") void manager.exportAccountArchive();
        },
      }}
    >
      <button type="button" className="topbar-icon-button" aria-label={t("actions.backup")}
        disabled={manager.archiveOperation !== null}>
        <Archive className={manager.archiveOperation ? "spin" : undefined} size={17} />
        <span>{t("actions.backup")}</span>
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
              icon: <RefreshCw className={manager.refreshingAll || refreshingProviderBalances ? "spin" : undefined} size={15} />,
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
          <RefreshCw className={manager.refreshingAll || refreshingProviderBalances || resetCredits.refreshingAll ? "spin" : undefined} size={17} />
          {t("actions.refresh")}
        </button>
      </Dropdown>
      <small className="last-auto-refresh">{t("actions.lastUpdated", { time: formatRefreshTime(lastRefreshAllAt, language) })}</small>
    </div>
  );
  const fileMenuItems: MenuProps["items"] = [
    { key: "add-account", label: t("actions.addAccount") },
    { type: "divider" },
    { key: "import-archive", label: t("actions.importArchive") },
    { key: "export-archive", label: t("actions.exportArchive") },
    { type: "divider" },
    { key: "open-codex-home", label: t("windowMenu.openCodexHome") },
    { key: "open-account-store", label: t("windowMenu.openAccountStore") },
    { type: "divider" },
    { key: "restart-app", label: t("windowMenu.restartApp") },
    { key: "quit-app", label: t("windowMenu.quit") },
  ];
  const navigateMenuItems: MenuProps["items"] = [
    { key: "accounts", label: t("nav.accounts") },
    { key: "providers", label: t("nav.providers") },
    { key: "token-usage", label: t("nav.tokenUsage") },
    { type: "divider" },
    { key: "dream-skin", label: t("nav.dreamSkin") },
    { key: "skills", label: t("nav.skills") },
    { type: "divider" },
    { key: "settings", label: t("nav.settings") },
  ];
  const toolsMenuItems: MenuProps["items"] = [
    { key: "refresh-all", label: t("actions.refreshAll") },
    { key: "refresh-reset-credits", label: t("actions.refreshResetCredits") },
    { key: "open-token-window", label: t("windowMenu.openTokenWindow") },
    { type: "divider" },
    { key: "start-chatgpt", label: t("actions.startChatGpt") },
    { key: "restart-chatgpt", label: t("actions.restartChatGpt") },
    { type: "divider" },
    { key: "export-logs", label: t("settings.logs.export") },
  ];
  const cloudMenuItems: MenuProps["items"] = [
    {
      key: "cloud-account",
      label: cloud.state.authenticated ? t("cloud.accountDetails") : t("cloud.login"),
    },
    { key: "cloud-sync", label: t("cloud.sync") },
    { key: "cloud-logout", label: t("cloud.logout"), disabled: !cloud.state.authenticated },
  ];
  const helpMenuItems: MenuProps["items"] = [
    { key: "notifications", label: t("notification.title") },
    { key: "help", label: t("help.open") },
    { key: "check-update", label: t("update.check") },
    { key: "feedback", label: t("feedback.title") },
    { type: "divider" },
    { key: "repository", label: t("help.github") },
    { key: "about", label: t("about.open") },
  ];
  const menuSearchItems: MenuSearchItem[] = [
    { id: "add-account", label: t("actions.addAccount"), group: t("windowMenu.file") },
    { id: "import-archive", label: t("actions.importArchive"), group: t("windowMenu.file") },
    { id: "export-archive", label: t("actions.exportArchive"), group: t("windowMenu.file") },
    { id: "open-codex-home", label: t("windowMenu.openCodexHome"), group: t("windowMenu.file") },
    { id: "open-account-store", label: t("windowMenu.openAccountStore"), group: t("windowMenu.file") },
    { id: "restart-app", label: t("windowMenu.restartApp"), group: t("windowMenu.file") },
    { id: "quit-app", label: t("windowMenu.quit"), group: t("windowMenu.file") },
    { id: "accounts", label: t("nav.accounts"), group: t("windowMenu.navigate") },
    { id: "providers", label: t("nav.providers"), group: t("windowMenu.navigate") },
    { id: "token-usage", label: t("nav.tokenUsage"), group: t("windowMenu.navigate") },
    { id: "dream-skin", label: t("nav.dreamSkin"), group: t("windowMenu.navigate") },
    { id: "skills", label: t("nav.skills"), group: t("windowMenu.navigate") },
    { id: "settings", label: t("nav.settings"), group: t("windowMenu.navigate") },
    { id: "refresh-all", label: t("actions.refreshAll"), group: t("windowMenu.tools") },
    { id: "refresh-reset-credits", label: t("actions.refreshResetCredits"), group: t("windowMenu.tools") },
    { id: "open-token-window", label: t("windowMenu.openTokenWindow"), group: t("windowMenu.tools") },
    { id: "start-chatgpt", label: t("actions.startChatGpt"), group: t("windowMenu.tools") },
    { id: "restart-chatgpt", label: t("actions.restartChatGpt"), group: t("windowMenu.tools") },
    { id: "export-logs", label: t("settings.logs.export"), group: t("windowMenu.tools") },
    {
      id: "cloud-account",
      label: cloud.state.authenticated ? t("cloud.accountDetails") : t("cloud.login"),
      group: t("windowMenu.cloud"),
    },
    { id: "cloud-sync", label: t("cloud.sync"), group: t("windowMenu.cloud") },
    {
      id: "cloud-logout",
      label: t("cloud.logout"),
      group: t("windowMenu.cloud"),
      disabled: !cloud.state.authenticated,
    },
    { id: "notifications", label: t("notification.title"), group: t("windowMenu.help") },
    { id: "help", label: t("help.open"), group: t("windowMenu.help") },
    { id: "check-update", label: t("update.check"), group: t("windowMenu.help") },
    { id: "feedback", label: t("feedback.title"), group: t("windowMenu.help") },
    { id: "repository", label: t("help.github"), group: t("windowMenu.help") },
    { id: "about", label: t("about.open"), group: t("windowMenu.help") },
  ];
  const windowMenu = (label: string, items: MenuProps["items"]) => (
    <Dropdown
      trigger={["click"]}
      placement="bottomLeft"
      overlayClassName="window-menu-dropdown"
      menu={{
        items,
        onClick: ({ key }) => handleSystemMenuAction(key as SystemMenuAction),
      }}
    >
      <button type="button" className="window-menu-trigger">{label}</button>
    </Dropdown>
  );
  const toggleWindowMaximized = () => {
    void getCurrentWindow().toggleMaximize().catch((error) => notify(String(error)));
  };
  const titlebarProxyBaseUrl = providerManager.localProxy?.port
    ? `http://${providerManager.localProxy.address}:${providerManager.localProxy.port}/v1`
    : "--";
  const copyTitlebarProxyBaseUrl = () => {
    if (!providerManager.localProxy) return;
    void navigator.clipboard.writeText(titlebarProxyBaseUrl)
      .then(() => notify(t("providers.proxy.endpointCopied")))
      .catch((error) => notify(String(error)));
  };
  const titlebarProxyRunning = Boolean(providerManager.localProxy?.running);
  const titlebarProxyStartDisabledReason = !isDesktopApp && !providerManager.localProxy?.port
    ? t("providers.proxy.webPortRequired")
    : activeAccount && !activeAccount.localProxyCompatible
      ? t("providers.proxy.agentIdentityUnsupported")
      : undefined;
  const titlebarProxyToggleDisabled = providerManager.proxyBusy
    || (!titlebarProxyRunning && Boolean(titlebarProxyStartDisabledReason));
  const titlebarProxyStatusSwitch = (
    <span className="window-titlebar-proxy-status"
      title={t(titlebarProxyRunning ? "providers.proxy.stop" : "providers.proxy.start")}>
      <span>{t(titlebarProxyRunning ? "providers.proxy.running" : "providers.proxy.stopped")}</span>
      <Switch className="window-titlebar-proxy-switch" size="small"
        checked={titlebarProxyRunning} loading={providerManager.proxyBusy}
        disabled={titlebarProxyToggleDisabled}
        aria-label={t(titlebarProxyRunning ? "providers.proxy.stop" : "providers.proxy.start")}
        onChange={(checked) => {
          if (!checked && titlebarProxyRunning) void providerManager.stopProxy();
        }} />
    </span>
  );
  const titlebarProxyStatusControl = titlebarProxyRunning ? titlebarProxyStatusSwitch
    : titlebarProxyStartDisabledReason ? (
      <Tooltip title={titlebarProxyStartDisabledReason}>
        <span className="window-titlebar-proxy-status-wrap">{titlebarProxyStatusSwitch}</span>
      </Tooltip>
    ) : (
      <Popconfirm title={t("providers.proxy.startConfirmTitle")}
        description={<span className="proxy-start-confirm-description">{t("providers.proxy.description")}</span>}
        okText={t("providers.proxy.start")} cancelText={t("providers.proxy.cancel")}
        disabled={providerManager.proxyBusy}
        onConfirm={() => void providerManager.startProxy()}>
        {titlebarProxyStatusSwitch}
      </Popconfirm>
    );
  const proxyStatusControls = (
    <div className={`window-titlebar-proxy${!isDesktopApp ? " web-proxy-controls" : ""}${titlebarProxyRunning ? " is-running" : ""}`}>
      <button type="button" className="window-titlebar-proxy-endpoint"
        disabled={!providerManager.localProxy?.port}
        aria-label={t("providers.proxy.copyEndpoint")}
        title={t("providers.proxy.copyEndpoint")}
        onClick={copyTitlebarProxyBaseUrl}>
        <span>{t("providers.proxy.baseUrl", { url: titlebarProxyBaseUrl })}</span>
        <Copy size={11} aria-hidden="true" />
      </button>
      {titlebarProxyStatusControl}
      {titlebarProxyRunning && (
        <Tooltip title="0.0.0.0">
          <span className="window-titlebar-proxy-lan">
            <span>{t("providers.proxy.listenLan")}</span>
            <Switch className="window-titlebar-proxy-lan-switch" size="small"
              checked={providerManager.localProxy?.listenOnAllInterfaces ?? false}
              loading={providerManager.proxyBusy}
              disabled={providerManager.proxyBusy}
              aria-label={t("providers.proxy.listenLan")}
              onChange={(enabled) => void providerManager.setProxyListenOnAllInterfaces(enabled)} />
          </span>
        </Tooltip>
      )}
    </div>
  );
  const proxyTopbarActions = titlebarProxyRunning ? (
    <>
      <Popover trigger="hover" placement="bottom" mouseEnterDelay={0.08} mouseLeaveDelay={0.12}
        content={(
          <div className="proxy-auto-switch-menu">
            <div className="proxy-auto-switch-menu-item"
              title={t("providers.proxy.autoSwitchTooltip")}>
              <span>{t("providers.proxy.autoSwitch")}</span>
              <Switch size="small"
                checked={providerManager.localProxy?.autoSwitchOnQuotaExhaustion ?? false}
                disabled={providerManager.proxyBusy}
                onChange={(enabled) => void providerManager.setProxyAutoSwitch(enabled)} />
            </div>
            <div className="proxy-auto-switch-menu-item"
              title={t("table.customPriorityTooltip")}>
              <span>{t("table.customPriorityEnabled")}</span>
              <Switch size="small"
                checked={providerManager.localProxy?.customAutoSwitchPriorityEnabled ?? false}
                disabled={providerManager.proxyBusy
                  || !providerManager.localProxy?.autoSwitchOnQuotaExhaustion}
                onChange={(enabled) => void providerManager.setProxyCustomPriority(enabled)} />
            </div>
            <div className="proxy-auto-switch-menu-item"
              title={t("providers.proxy.autoDisableUnreachableTooltip")}>
              <span>{t("providers.proxy.autoDisableUnreachable")}</span>
              <Switch size="small"
                checked={providerManager.localProxy?.autoDisableUnreachableAccounts ?? false}
                disabled={providerManager.proxyBusy
                  || !providerManager.localProxy?.autoSwitchOnQuotaExhaustion}
                onChange={(enabled) => void providerManager.setProxyAutoDisableUnreachable(enabled)} />
            </div>
          </div>
        )}>
        <button type="button"
          className={`refresh-all proxy-topbar-action${providerManager.localProxy?.autoSwitchOnQuotaExhaustion ? " active" : ""}`}
          aria-label={t("providers.proxy.autoSwitch")}>
          <Shuffle size={14} />
          <span>{t("providers.proxy.autoSwitch")}</span>
          <ChevronDown size={12} />
        </button>
      </Popover>
      <ProxySessionManager t={t} triggerClassName="refresh-all proxy-topbar-action" />
    </>
  ) : null;
  const menuTools = (
    <div className="menu-tools">
      <Dropdown
        trigger={["click"]}
        menu={{
          items: cloud.state.authenticated
            ? [
              { key: "account", icon: <Cloud size={15} />, label: t("cloud.accountDetails") },
              { type: "divider" },
              { key: "logout", icon: <LogOut size={15} />, label: t("cloud.logout"), disabled: cloud.loading },
              { type: "divider" },
              { key: "settings", icon: <Settings size={15} />, label: t("nav.settings") },
              { key: "checkUpdate", icon: <RefreshCw size={15} />, label: t("update.check"), disabled: checkingForUpdate },
              { key: "feedback", icon: <MessageSquareText size={15} />, label: t("feedback.title") },
              { key: "repository", icon: <Github size={15} />, label: t("help.github") },
              { key: "help", icon: <CircleHelp size={15} />, label: t("help.open") },
              { key: "about", icon: <ShieldCheck size={15} />, label: t("about.open") },
            ]
            : [
              { key: "login", icon: <LogIn size={15} />, label: t("cloud.login"), disabled: cloud.loading },
              { type: "divider" },
              { key: "settings", icon: <Settings size={15} />, label: t("nav.settings") },
              { key: "checkUpdate", icon: <RefreshCw size={15} />, label: t("update.check"), disabled: checkingForUpdate },
              { key: "feedback", icon: <MessageSquareText size={15} />, label: t("feedback.title") },
              { key: "repository", icon: <Github size={15} />, label: t("help.github") },
              { key: "help", icon: <CircleHelp size={15} />, label: t("help.open") },
              { key: "about", icon: <ShieldCheck size={15} />, label: t("about.open") },
            ],
          onClick: ({ key }) => {
            if (key === "account") openCloudAccount();
            if (key === "logout") void cloud.logout();
            if (key === "login") openCloudLogin();
            if (key === "settings") setPage("settings");
            if (key === "checkUpdate") void checkForUpdates();
            if (key === "feedback") setShowFeedback(true);
            if (key === "help") openHelp();
            if (key === "about") openAbout();
            if (key === "repository") openRepository();
          },
        }}
      >
        <button type="button" className={`cloud-avatar-button${cloud.state.authenticated ? " authenticated" : ""}`}
          aria-label={cloud.state.authenticated ? t("cloud.accountDetails") : t("cloud.login")}
          title={cloud.state.authenticated ? (cloud.state.userEmail ?? t("cloud.signedIn")) : t("cloud.login")}
          disabled={cloud.loading}>
          <span>{cloud.state.authenticated ? (cloud.state.userEmail ?? t("cloud.signedIn")) : t("cloud.login")}</span>
          <ChevronDown size={14} />
        </button>
      </Dropdown>
      <Popover
        placement="bottomRight"
        trigger="click"
        open={notificationsOpen}
        content={notificationPanel}
        onOpenChange={(open) => {
          setNotificationsOpen(open);
          if (!open) return;
          const seenAt = new Date().toISOString();
          window.localStorage.setItem(LAST_NOTIFICATION_SEEN_KEY, seenAt);
          setLastNotificationSeenAt(seenAt);
        }}
      >
        <button type="button" className="notification-button" aria-label={t("notification.title")}>
          <Bell size={18} />
          {unreadNotificationCount > 0 && (
            <span className="notification-unread-badge" aria-hidden="true" />
          )}
        </button>
      </Popover>
      {availableUpdate && (updateDownloaded || (downloadingUpdate && installAfterDownloadRequested)) && (
        <Tooltip title={downloadingUpdate
          ? (updateProgress === null
            ? t("update.backgroundDownloading")
            : t("update.downloading", { progress: updateProgress }))
          : t("update.ready")}>
          <button type="button" className={`update-ready-button${downloadingUpdate ? " downloading" : ""}`}
            style={downloadingUpdate
              ? { "--update-progress": `${updateProgress ?? 0}%` } as CSSProperties
              : undefined}
            aria-label={downloadingUpdate ? t("update.backgroundDownloading") : t("update.ready")}
            onClick={() => setShowUpdatePrompt(true)}>
            {downloadingUpdate ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}
            {updateDownloaded && !downloadingUpdate && <span className="update-install-badge" aria-hidden="true" />}
          </button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <ConfigProvider locale={language === "zh" ? zhCN : enUS} theme={{
      algorithm: antdTheme.compactAlgorithm,
      token: { colorPrimary: themeColor.color, borderRadius: 6, fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif" },
    }}>
      <div className={`app-shell${CUSTOM_TITLEBAR_ENABLED ? " custom-titlebar-shell" : ""}`}>
        {CUSTOM_TITLEBAR_ENABLED && (
          <header className="window-titlebar">
            <div className="window-titlebar-icon-zone" data-tauri-drag-region>
              <img src={APP_LOGO_URL} alt="" data-tauri-drag-region />
            </div>
            <nav className="window-menu-bar" aria-label={t("windowMenu.aria")}>
              {windowMenu(t("windowMenu.file"), fileMenuItems)}
              {windowMenu(t("windowMenu.navigate"), navigateMenuItems)}
              {windowMenu(t("windowMenu.tools"), toolsMenuItems)}
              {windowMenu(t("windowMenu.cloud"), cloudMenuItems)}
              {windowMenu(t("windowMenu.help"), helpMenuItems)}
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
        <header className="app-menu">
          <button type="button" className="brand" onClick={openRepository}
            aria-label={t("help.github")} title={t("help.github")}>
            <img className="brand-logo" src={APP_LOGO_URL} alt="" />
            <span>Codex<br /><b>Switch</b></span>
          </button>
          <div className="announcement-slot" aria-live="polite">
            {announcementLink ? (
              <button
                type="button"
                className="announcement-marquee announcement-marquee-link"
                title={announcementText}
                style={announcementStyle}
                onClick={openAnnouncementLink}
              >
                {announcementTrack}
              </button>
            ) : (
              <div
                className="announcement-marquee"
                title={announcementText}
                style={announcementStyle}
              >
                {announcementTrack}
              </div>
            )}
          </div>
          <nav className="top-tabs" aria-label={t("nav.aria")}>
            <button className={page === "accounts" ? "selected" : ""} onClick={() => setPage("accounts")}>
              <UserRound size={19} />{t("nav.accounts")}</button>
            <button className={page === "providers" ? "selected" : ""} onClick={() => setPage("providers")}>
              <Server size={19} />{t("nav.providers")}</button>
            <button className={page === "tokens" ? "selected" : ""} onClick={() => setPage("tokens")}>
              <BarChart3 size={19} />{t("nav.tokenUsage")}</button>
            <button className={page === "dreamSkin" ? "selected" : ""} onClick={() => setPage("dreamSkin")}>
              <Palette size={19} />{t("nav.dreamSkin")}</button>
            <button className={page === "skills" ? "selected" : ""} onClick={() => setPage("skills")}>
              <PackageOpen size={19} />{t("nav.skills")}</button>
          </nav>
          {!CUSTOM_TITLEBAR_ENABLED && menuTools}
        </header>

        <main className={page === "accounts" ? "accounts-main" : page === "tokens" ? "tokens-main" : page === "dreamSkin" ? "dream-skin-main" : undefined}>
          {page !== "tokens" && page !== "dreamSkin" && (
          <header className={`topbar${page === "accounts" && providerManager.localProxy?.running ? " accounts-topbar" : ""}`}>
            {page === "accounts" && providerManager.localProxy?.running ? (
              <TokenUsageHeatmap weeks={tokenUsagePreferences.weeks}
                refreshSeconds={tokenUsagePreferences.refreshSeconds} language={language} t={t} />
            ) : (
              <div><span className="eyebrow">{page === "providers"
                ? t("topbar.providersEyebrow")
                : page === "skills"
                  ? t("topbar.skillsEyebrow")
                  : t("topbar.eyebrow")}</span>
                <h1>{page === "settings"
                  ? t("topbar.settings")
                  : page === "skills"
                    ? t("topbar.skills")
                  : page === "providers"
                    ? t("topbar.providers", { count: providerManager.providers.length })
                    : t("topbar.accounts", { count: manager.accounts.length })}</h1></div>
            )}
            {page === "accounts" && (
              <div className="topbar-actions">
                <button className="primary-button" onClick={openLogin}><Plus size={18} />{t("actions.addAccount")}</button>
                {backupActionMenu}
                {refreshActionMenu}
                {chatGptActionMenu}
                {cloud.state.authenticated && (
                  <Tooltip title={t("cloud.syncDescription")}>
                    <button type="button" className="refresh-all cloud-sync-action" disabled={cloud.syncing}
                      onClick={() => void syncCloud()}>
                      <UploadCloud className={cloud.syncing ? "spin" : ""} size={17} />{t("cloud.sync")}
                    </button>
                  </Tooltip>
                )}
                {proxyTopbarActions}
              </div>
            )}
            {page === "providers" && (
              <div className="topbar-actions">
                <Tooltip title="Token 消耗汇总">
                  <button className="refresh-all" onClick={() => void openTokenUsage()}>
                    <BarChart3 size={17} />Token 汇总
                  </button>
                </Tooltip>
                {chatGptActionMenu}
                {cloud.state.authenticated && (
                  <Tooltip title={t("cloud.syncDescription")}>
                    <button type="button" className="refresh-all cloud-sync-action" disabled={cloud.syncing}
                      onClick={() => void syncCloud()}>
                      <UploadCloud className={cloud.syncing ? "spin" : ""} size={17} />{t("cloud.sync")}
                    </button>
                  </Tooltip>
                )}
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
          </header>
          )}

          <section className="page-panel" hidden={page !== "dreamSkin"}>
            <MemoDreamSkinPage t={t} notify={notify} />
          </section>
          <section className="page-panel" hidden={page !== "settings"}>
            <MemoSettingsPage info={manager.info} autoRefreshEnabled={autoRefresh.enabled}
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
              onCloudBaseUrlSave={saveCloudBaseUrl}
              floatingBubbleEnabled={floatingBubble.enabled}
              floatingBubbleLoading={floatingBubble.loading} onFloatingBubbleChange={changeFloatingBubble}
              bubbleResetDisplay={bubbleResetDisplay.display} bubbleResetDisplayLoading={bubbleResetDisplay.loading}
              onBubbleResetDisplayChange={changeBubbleResetDisplay}
              bubbleStyle={bubbleStyle.style} bubbleStyleLoading={bubbleStyle.loading}
              onBubbleStyleChange={changeBubbleStyle}
              privacyModeEnabled={privacyMode.enabled} privacyModeLoading={privacyMode.loading}
              onPrivacyModeChange={changePrivacyMode}
              accountDisplayMode={accountDisplayMode.displayMode}
              onAccountDisplayModeChange={accountDisplayMode.setDisplayMode}
              tokenUsageWeeks={tokenUsagePreferences.weeks}
              tokenUsageRefreshSeconds={tokenUsagePreferences.refreshSeconds}
              tokenUsagePreferencesLoading={tokenUsagePreferences.loading}
              webProxyPort={!isDesktopApp ? webProxyPort : undefined}
              webProxyPortLoading={!isDesktopApp ? webProxyPortLoading : undefined}
              onWebProxyPortChange={!isDesktopApp ? changeWebProxyPort : undefined}
              onTokenUsageWeeksChange={tokenUsagePreferences.updateWeeks}
              onTokenUsageRefreshSecondsChange={tokenUsagePreferences.updateRefreshSeconds}
              onOpenCodexHome={openCodexHome} onOpenAccountStore={openAccountStore} language={language}
              onExportLogs={() => void exportLogs()} exportingLogs={exportingLogs}
              onLanguageChange={setLanguage} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "skills"}>
            <MemoSkillsMarketPage baseUrl={cloud.state.baseUrl}
              authenticated={cloud.state.authenticated} currentUserId={cloud.state.userId}
              onLogin={openCloudLogin} notify={notify} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "providers"}>
            <MemoProvidersPage providers={providerManager.providers}
              loading={providerManager.loading}
              busyProviderId={providerManager.busyProviderId} saving={providerManager.saving}
              localProxy={providerManager.localProxy}
              info={manager.info} onSave={providerManager.saveProvider}
              onSwitch={switchProvider} onSwitchModel={switchProviderModel}
              onModelControlChange={setProviderModelControl} onDelete={deleteProvider}
              displayMode={accountDisplayMode.displayMode} t={t} />
          </section>
          <section className="page-panel token-dashboard-page" hidden={page !== "tokens"}>
            <TokenUsageDashboard language={language} themeColor={themeColor.color}
              weeks={tokenUsagePreferences.weeks}
              refreshSeconds={tokenUsagePreferences.refreshSeconds}
              onWeeksChange={tokenUsagePreferences.updateWeeks}
              preferencesLoading={tokenUsagePreferences.loading} embedded />
          </section>
          <section className="page-panel accounts-page-panel" hidden={page !== "accounts"}>
            <MemoAccountsPage accounts={manager.accounts} loading={manager.loading}
              busyAccountId={manager.busyAccountId} onAdd={openLogin}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              onSwitch={switchAccount}
              onRefresh={refreshUsage}
              onDelete={deleteAccount}
              onDeleteMany={manager.deleteAccounts}
              onEnableMany={manager.enableAutoSwitchAccounts}
              onDisableMany={manager.disableAutoSwitchAccounts}
              onAutoSwitchEnabledChange={setAccountAutoSwitchEnabled}
              autoSwitchBusyAccountId={manager.autoSwitchBusyAccountId}
              onAutoSwitchPriorityChange={manager.setAutoSwitchPriority}
              autoSwitchPriorityBusyAccountId={manager.autoSwitchPriorityBusyAccountId}
              onSaveNote={saveAccountNote}
              resetCredits={resetCredits.states}
              onLoadResetCredits={loadResetCredits}
              onUseResetCredit={(id) => void useResetCredit(id)}
              resetCreditBusyAccountId={resetCreditBusyAccountId}
              onOpenaiAuthAccountChange={providerManager.setProxyOpenaiAuthAccount}
              privacyMode={privacyMode.enabled}
              displayMode={accountDisplayMode.displayMode}
              tokenUsageRefreshSeconds={tokenUsagePreferences.refreshSeconds}
              proxyControls={!isDesktopApp ? proxyStatusControls : undefined}
              language={language} t={t} />
          </section>
        </main>

        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onStart={startLogin}
          onImport={importAccountJson} onImportClipboard={importAccountJsonFromClipboard} t={t} />}
        {showMenuSearch && <MenuSearchModal items={menuSearchItems} onClose={() => setShowMenuSearch(false)}
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
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} onUpdate={openHelpUpdate}
          onFeedback={() => setShowFeedback(true)} version={manager.info?.version ?? "0.1.0"}
          versionState={helpVersionState} faq={faqs.map((item) => ({
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
        {toast && <div className="toast"><Check size={17} />{toast}</div>}
      </div>
    </ConfigProvider>
  );
}

export default function App() {
  const normalizeWindowName = (value: string | null) => (
    (value ?? "").replace(/^#\/?/, "").split(/[?#]/)[0]
  );
  const windowName = normalizeWindowName(new URLSearchParams(window.location.search).get("window"))
    || normalizeWindowName(window.location.hash);
  if (windowName === "bubble") {
    return <FloatingUsageBubble />;
  }
  if (windowName === "token-usage") {
    return <TokenUsageWindow />;
  }
  return <DashboardApp />;
}
