import { getLocale, t, useLanguage } from './i18n';
import type { RemoteModelTarget } from '../../../shared/remote-chat/modelTarget';
import { profileRole } from './i18n/profile';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Form, Input, PullToRefresh, SafeArea, SpinLoading, TabBar, Toast } from "antd-mobile";
import { Dropdown, Tooltip, type MenuProps } from "antd";
import { ChevronRight, CircleGauge, Laptop, LayoutDashboard, LogOut, Menu, MonitorCog,
  MessageSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Server, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { defaultApiBaseUrl, deviceStatusWebSocketUrl, getActiveSession, parseDeviceStatusMessage } from "./api";
import { useAppDispatch, useAppSelector } from "./hooks";
import { bootstrapApp, clearAuthError, clearDataError, deviceSocketMessage, pageChanged, refreshAll,
  removeDevice, setDeviceOpenAiAuthAccount, signIn, signOut, switchDeviceAccount,
  switchDeviceProvider, switchDeviceProviderGroup } from "./store";
import type { AppPage, RemoteDevice } from "./types";
import { AdaptiveSheet } from "./components/AdaptiveSheet";
import { BrandMark } from "./components/BrandMark";
import { RegistrationSheet } from "./components/RegistrationSheet";
import { DeviceManagementList } from "./devices/DeviceManagementList";
import { useRemoteModelRestartPrompt } from "./devices/useRemoteModelRestartPrompt";
import { RemoteModelSwitchSheet } from "./components/RemoteModelSwitchSheet";
import { TotpPage } from "./components/TotpPage";
import { AccountsPage } from "./accounts/AccountsPage";
import { SettingsPage } from "./settings/SettingsPage";
import { loadRefreshMinutes, REFRESH_INTERVAL_EVENT } from "./settings/refreshInterval";
import { useTotpVault } from "./useTotpVault";
import { ChatPage } from "./chat/ChatPage";
import { usePanelVisibility } from "./useDesktopLayout";

const PULL_REFRESH_TEXT = {
  get pulling() { return t("下拉刷新"); },
  get canRelease() { return t("释放立即刷新"); },
  get refreshing() { return t("正在刷新…"); },
  get complete() { return t("刷新完成"); },
} as const;

function LoginView() {
  useLanguage();
  const dispatch = useAppDispatch();
  const { submitting, error } = useAppSelector((state) => state.auth);
  const [baseUrl, setBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      Toast.show({ icon: "fail", content: t("请填写邮箱和密码") });
      return;
    }
    try {
      await dispatch(signIn({ baseUrl, email, password })).unwrap();
      Toast.show({ icon: "success", content: t("欢迎回来") });
    } catch {
      // The Redux state renders the actionable server error.
    }
  };

  return <main className="login-page">
    <section className="login-story">
      <div className="story-grid" />
      <div className="brand-lockup light"><BrandMark /><b>Codex Switch</b></div>
      <div className="story-copy">
        <span className="eyebrow"><Sparkles size={14} />  {t("随时掌握每个账号")}</span>
        <h1>{t("离开电脑，也能")}<br />{t("从容切换。")}</h1>
        <p>{t("一处查看账号用量、设备在线状态，并远程切换桌面端正在使用的账号。")}</p>
        <div className="story-points">
          <span><CircleGauge size={17} />  {t("实时用量")}</span>
          <span><MonitorCog size={17} />  {t("远程控制")}</span>
          <span><ShieldCheck size={17} />  {t("安全登录")}</span>
        </div>
      </div>
      <small>{t("随时连接，自在切换")}</small>
    </section>
    <section className="login-panel">
      <div className="mobile-login-brand brand-lockup">
        <BrandMark />
        <b>Codex Switch</b><span className="login-web-badge">Web</span>
      </div>
      <div className="login-form-wrap">
        <span className="login-kicker">{t("云端控制台")}</span>
        <h2>{t("欢迎回来")}</h2>
        <p className="login-intro">{t("登录云端账号，随时管理用量与设备。")}</p>
        <Form className="login-form" layout="vertical" footer={<div className="login-actions">
          <Button className="login-register" color="primary" fill="outline" size="large"
            type="button" onClick={() => setShowRegistration(true)}>{t("注册")}</Button>
          <Button block color="primary" size="large" loading={submitting} onClick={submit}>{t("登录并查看")}</Button>
        </div>}>
          <Form.Item label={t("邮箱")}>
            <Input value={email} onChange={(value) => { setEmail(value); dispatch(clearAuthError()); }}
              type="email" inputMode="email" autoCapitalize="none"
              aria-label={t("邮箱")} autoComplete="email" placeholder="name@example.com" clearable />
          </Form.Item>
          <Form.Item label={t("密码")}>
            <Input value={password} onChange={(value) => { setPassword(value); dispatch(clearAuthError()); }}
              type="password" aria-label={t("密码")} autoComplete="current-password" placeholder={t("输入登录密码")}
              onEnterPress={() => void submit()} clearable />
          </Form.Item>
          <button type="button" className="server-toggle" aria-expanded={showServer}
            aria-controls="login-server" onClick={() => setShowServer((value) => !value)}>
            <Server size={15} /> {showServer ? t("收起服务器设置") : t("连接其他服务器")} <ChevronRight size={14} />
          </button>
          <div id="login-server" hidden={!showServer}>
            {showServer ? <Form.Item label={t("服务器地址")} help={t("使用自己的服务器时填写，通常无需修改。")}>
              <Input value={baseUrl} onChange={setBaseUrl} type="url" inputMode="url" aria-label={t("服务器地址")}
                autoCapitalize="none" placeholder="https://api.example.com" clearable />
            </Form.Item> : null}
          </div>
          {error ? <div className="form-error" role="alert">{t(error)}</div> : null}
        </Form>
        <div className="login-security"><ShieldCheck size={16} /><span>{t("安全连接，安心管理你的账号。")}</span></div>
      </div>
    </section>
    <RegistrationSheet open={showRegistration} onClose={() => setShowRegistration(false)} />
  </main>;
}

function DevicesPage() {
  useLanguage();
  const dispatch = useAppDispatch();
  const {
    accounts,
    providers,
    devices,
    refreshing,
    deletingDeviceId,
    switchingAccountId,
    switchingProvider,
    switchingOpenAiAuth,
  } = useAppSelector((state) => state.data);
  const promptModelRestart = useRemoteModelRestartPrompt();
  const [authDeviceId, setAuthDeviceId] = useState<string | null>(null);
  const [modelDeviceId, setModelDeviceId] = useState<string | null>(null);
  const authDevice = devices.find((item) => item.deviceId === authDeviceId) ?? null;
  const modelDevice = devices.find((item) => item.deviceId === modelDeviceId) ?? null;
  const sorted = useMemo(() => [...devices].sort((left, right) => Number(right.online) - Number(left.online)
    || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)), [devices]);
  const performRefresh = useCallback(async () => {
    try { await dispatch(refreshAll()).unwrap(); }
    catch { /* The global error toast reports the failure. */ }
  }, [dispatch]);

  const deleteDevice = async (device: RemoteDevice) => {
    if (device.online || deletingDeviceId) return;
    const confirmed = await Dialog.confirm({
      title: t("删除这台设备？"),
      content: t("“{value1}”再次登录桌面端后仍会重新出现在这里。", { value1: device.name }),
      confirmText: t("删除设备"),
    });
    if (!confirmed) return;
    try {
      await dispatch(removeDevice(device.deviceId)).unwrap();
      Toast.show({ icon: "success", content: t("设备已删除") });
    } catch { /* Global toast */ }
  };

  const switchOfficialModel = async (deviceId: string, accountId: string, target: RemoteModelTarget = 'proxy') => {
    try {
      const result = await dispatch(switchDeviceAccount({ deviceId, accountId, target })).unwrap();
      Toast.show({ icon: "success", content: target === 'gui'
        ? t("Codex GUI 模型已切换") : t("代理接口模型已切换") });
      if (result.result.requiresRestart) {
        window.setTimeout(() => void promptModelRestart(deviceId), 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  const switchProviderModel = async (deviceId: string, providerId: string, target: RemoteModelTarget = 'proxy') => {
    try {
      const result = await dispatch(switchDeviceProvider({ deviceId, providerId, target })).unwrap();
      Toast.show({ icon: "success", content: target === 'gui'
        ? t("Codex GUI 模型已切换") : t("代理接口模型已切换") });
      if (result.result.requiresRestart) {
        window.setTimeout(() => void promptModelRestart(deviceId), 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  const switchProviderGroup = async (deviceId: string, group: string) => {
    try {
      const result = await dispatch(switchDeviceProviderGroup({ deviceId, group })).unwrap();
      Toast.show({ icon: "success", content: t("已启动分组“{value1}”", { value1: group }) });
      if (result.result.requiresRestart) {
        window.setTimeout(() => void promptModelRestart(deviceId), 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  return <>
    <PullToRefresh onRefresh={performRefresh} renderText={(status) => PULL_REFRESH_TEXT[status]}>
      <DeviceManagementList devices={sorted} accounts={accounts} providers={providers}
        refreshing={refreshing} onRefresh={performRefresh} deletingDeviceId={deletingDeviceId}
        switchingModelDeviceId={switchingProvider?.deviceId ?? (switchingAccountId ? modelDeviceId : null)}
        switchingAuthDeviceId={switchingOpenAiAuth?.deviceId ?? null}
        onSwitchModel={setModelDeviceId} onSelectAuthAccount={setAuthDeviceId}
        onDelete={(device) => void deleteDevice(device)} />
    </PullToRefresh>
    <RemoteModelSwitchSheet
      key={modelDeviceId ?? 'closed'}
      device={modelDevice}
      accounts={accounts}
      providers={providers}
      switchingAccountId={switchingAccountId}
      switchingProviderId={switchingProvider
        && switchingProvider.deviceId === modelDevice?.deviceId
        ? switchingProvider.providerId : null}
      onClose={() => setModelDeviceId(null)}
      onSwitchAccount={switchOfficialModel}
      onSwitchProvider={switchProviderModel}
      onSwitchProviderGroup={switchProviderGroup}
    />
    <AdaptiveSheet open={Boolean(authDevice)} title={t("代理登录态账号")}
      subtitle={authDevice ? t("{value1} · 选择后会重启 ChatGPT/Codex", { value1: authDevice.name }) : undefined}
      onClose={() => setAuthDeviceId(null)}>
      <div className="select-list account-select-list">{accounts.map((account) => {
        const current = authDevice?.openaiAuthAccountId === account.id;
        return <button type="button" disabled={current || Boolean(switchingOpenAiAuth)} key={account.id}
          onClick={async () => {
            try {
              await dispatch(setDeviceOpenAiAuthAccount({
                deviceId: authDevice!.deviceId,
                accountId: account.id,
              })).unwrap();
              Toast.show({ icon: "success", content: t("代理登录态已更新") });
              setAuthDeviceId(null);
            } catch { /* Global toast */ }
          }}>
          <span className="account-initial">{account.email.slice(0, 2).toUpperCase()}</span>
          <span><strong>{account.email}</strong><small>{account.plan || "ChatGPT"}</small></span>
          {current ? <b className="current-pill">{t("当前")}</b> : <ChevronRight size={18} />}
        </button>;
      })}</div>
    </AdaptiveSheet>
  </>;
}

const navItems: Array<{ key: AppPage; label: string; icon: typeof LayoutDashboard }> = [
  { key: "chat", get label() { return t("聊天"); }, icon: MessageSquare },
  { key: "accounts", get label() { return t("账号"); }, icon: LayoutDashboard },
  { key: "devices", get label() { return t("设备"); }, icon: Laptop },
  { key: "totp", label: "2FA", icon: ShieldCheck },
  { key: "settings", get label() { return t("设置"); }, icon: Settings },
];

function AppShell() {
  useLanguage();
  const [menuVisible, setMenuVisible] = usePanelVisibility('main-menu');
  const dispatch = useAppDispatch();
  const { session } = useAppSelector((state) => state.auth);
  const { page, profile, devices, refreshing, lastRefreshAt, error } = useAppSelector((state) => state.data);
  const lastRefreshRef = useRef(Date.now());
  const totpManager = useTotpVault(session);
  const onlineCount = devices.filter((item) => item.online).length;

  useEffect(() => {
    if (!error) return;
    Toast.show({ icon: "fail", content: t(error) });
    dispatch(clearDataError());
  }, [dispatch, error]);

  useEffect(() => {
    if (session && lastRefreshAt === null) void dispatch(refreshAll());
  }, [dispatch, lastRefreshAt, session]);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let attempt = 0;
    const connect = () => {
      if (stopped || socket) return;
      try { socket = new WebSocket(deviceStatusWebSocketUrl(session.baseUrl)); }
      catch { return; }
      const current = socket;
      current.onopen = () => {
        attempt = 0;
        const latest = getActiveSession();
        if (latest) current.send(JSON.stringify({ type: "subscribe-devices", accessToken: latest.accessToken }));
      };
      current.onmessage = (event) => {
        const message = parseDeviceStatusMessage(event.data);
        if (message) dispatch(deviceSocketMessage(message));
      };
      current.onerror = () => undefined;
      current.onclose = () => {
        if (socket === current) socket = null;
        if (stopped) return;
        timer = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      socket?.close(1000, "Web session ended");
    };
  }, [dispatch, session]);

  useEffect(() => {
    if (!session) return;
    let intervalId: number;
    const schedule = () => {
      window.clearInterval(intervalId);
      intervalId = window.setInterval(() => {
        const minutes = loadRefreshMinutes();
        if (Date.now() - lastRefreshRef.current >= minutes * 60_000) {
          lastRefreshRef.current = Date.now();
          void dispatch(refreshAll());
        }
      }, 60_000);
    };
    schedule();
    window.addEventListener(REFRESH_INTERVAL_EVENT, schedule);
    return () => { window.clearInterval(intervalId); window.removeEventListener(REFRESH_INTERVAL_EVENT, schedule); };
  }, [dispatch, session]);

  const userMenu: MenuProps["items"] = [
    { key: "settings", label: t("账户设置"), icon: <Settings size={16} />, onClick: () => dispatch(pageChanged("settings")) },
    ...(profile?.role === "admin" ? [{ key: "admin", label: t("管理员控制台"), icon: <ShieldCheck size={16} />, onClick: () => window.location.assign(`${session?.baseUrl ?? window.location.origin}/admin`) }] : []),
    { type: "divider" as const },
    { key: "logout", label: t("退出登录"), danger: true, icon: <LogOut size={16} />, onClick: () => void dispatch(signOut()) },
  ];

  const pageDescriptions: Record<Exclude<AppPage, 'chat'>, string> = {
    accounts: t("欢迎回来，今天也保持从容。"),
    devices: t("查看并控制你的桌面设备。"), totp: t("管理并同步你的 2FA 验证码。"), settings: t("管理偏好与账户安全。"),
  };
  const otherPages = {
    accounts: <AccountsPage />, devices: <DevicesPage />,
    totp: <TotpPage manager={totpManager} />, settings: <SettingsPage totpManager={totpManager} />,
  };
  const shellClass = `app-shell${page === 'chat' ? ' chat-active' : ''}${menuVisible ? '' : ' main-menu-collapsed'}`;
  const MenuToggleIcon = menuVisible ? PanelLeftClose : PanelLeftOpen;
  return <div className={shellClass}>
    <aside className="desktop-sidebar">
      <div className="desktop-sidebar-heading">
        <div className="brand-lockup"><BrandMark />
          <b>Codex Switch</b></div>
        <button type="button" className="main-menu-toggle" aria-label={menuVisible ? t("收起主菜单") : t("展开主菜单")}
          aria-expanded={menuVisible} onClick={() => setMenuVisible(value => !value)}>
          <MenuToggleIcon size={20} /></button>
      </div>
      <nav>{navItems.map((item) => <Tooltip key={item.key} placement="right"
        title={menuVisible ? undefined : item.label}>
        <button type="button" aria-label={item.label} aria-current={page === item.key ? 'page' : undefined}
          className={`sidebar-nav-${item.key}${page === item.key ? ' active' : ''}`}
          onClick={() => dispatch(pageChanged(item.key))}>
          <item.icon size={19} /><span>{item.label}</span>
          {item.key === "devices" && onlineCount ? <b>{onlineCount}</b> : null}
        </button>
      </Tooltip>)}</nav>
      <div className="sidebar-live"><span><i />  {t("服务已连接")}</span><p>{t("安心管理账号与设备")}</p></div>
      <Tooltip placement="right" title={menuVisible ? undefined : t("账户菜单")}>
        <Dropdown menu={{ items: userMenu }} trigger={["click"]}>
          <button type="button" className="sidebar-profile" aria-label={t("账户菜单")}>
            <span>{(profile?.email || session?.email || "U").slice(0, 2).toUpperCase()}</span>
            <div><strong>{profile?.email || session?.email}</strong>
              <small>{profileRole(profile)}</small></div>
            <Menu size={17} />
          </button>
        </Dropdown>
      </Tooltip>
    </aside>
    <div className="content-shell">
      {page !== 'chat' && <header className="desktop-topbar"><div>
        <span>{navItems.find((item) => item.key === page)?.label}</span><strong>{pageDescriptions[page]}</strong></div>
        <div><Tooltip title={t("刷新全部数据")}><button className="icon-button" type="button"
          onClick={() => void dispatch(refreshAll())}>
          <RefreshCw size={18} className={refreshing ? "spin" : ""} /></button></Tooltip>
          <span className="topbar-date">{new Intl.DateTimeFormat(getLocale(),
            { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</span></div></header>}
      <main className="main-content">
        {session && <ChatPage key={session.baseUrl + session.email} session={session} devices={devices}
          active={page === "chat"} />}
        {page !== "chat" && otherPages[page]}
      </main>
    </div>
    <div className="mobile-tabbar"><TabBar activeKey={page} onChange={(key) => dispatch(pageChanged(key as AppPage))}>{navItems.map((item) => <TabBar.Item key={item.key} title={item.label} icon={<item.icon size={21} />} badge={item.key === "devices" && onlineCount ? onlineCount : undefined} />)}</TabBar><SafeArea position="bottom" /></div>
  </div>;
}

export default function App() {
  useLanguage();
  const dispatch = useAppDispatch();
  const { session, initialized } = useAppSelector((state) => state.auth);
  useEffect(() => { void dispatch(bootstrapApp()); }, [dispatch]);
  if (!initialized) return <div className="boot-screen"><BrandMark /><SpinLoading color="primary" />
    <p>{t("正在打开 Codex Switch")}</p></div>;
  return session ? <AppShell /> : <LoginView />;
}
