import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Dialog,
  Empty,
  Form,
  Input,
  List,
  PullToRefresh,
  SafeArea,
  SpinLoading,
  Switch,
  TabBar,
  Toast,
} from "antd-mobile";
import { Dropdown, Tooltip, type MenuProps } from "antd";
import {
  ChevronRight,
  CircleAlert,
  CircleGauge,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorCog,
  MoreHorizontal,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Wifi,
  Zap,
} from "lucide-react";
import {
  apiJson,
  consumeResetCredit,
  defaultApiBaseUrl,
  deviceStatusWebSocketUrl,
  fetchResetCredits,
  getActiveSession,
  parseDeviceStatusMessage,
} from "./api";
import { useAppDispatch, useAppSelector } from "./hooks";
import {
  bootstrapApp,
  clearAuthError,
  clearDataError,
  deviceSocketMessage,
  pageChanged,
  refreshAll,
  refreshOneAccount,
  removeDevice,
  restartDeviceCodex,
  setDeviceOpenAiAuthAccount,
  signIn,
  signOut,
  switchDeviceAccount,
  switchDeviceProvider,
  switchDeviceProviderGroup,
} from "./store";
import type { AccountSummary, AppPage, RemoteDevice, ResetCredit, UsageWindow } from "./types";
import { AdaptiveSheet } from "./components/AdaptiveSheet";
import { AccountDetailsSheet } from "./components/AccountDetailsSheet";
import { AddAccountSheet } from "./components/AddAccountSheet";
import { RemoteModelSwitchSheet } from "./components/RemoteModelSwitchSheet";
import { TotpPage } from "./components/TotpPage";

const REFRESH_INTERVAL_KEY = "codex-switch.web.refresh-minutes.v1";
const PULL_REFRESH_TEXT = {
  pulling: "下拉刷新",
  canRelease: "释放立即刷新",
  refreshing: "正在刷新…",
  complete: "刷新完成",
} as const;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function formatDate(value?: string | null, full = false) {
  if (!value) return "尚未刷新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", full ? {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  } : {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function resetLabel(timestamp?: number | null) {
  if (!timestamp) return "重置时间暂不可用";
  const left = timestamp * 1000 - Date.now();
  if (left <= 0) return "即将重置";
  const totalMinutes = Math.floor(left / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分钟后重置`;
}

function maskEmail(email: string) {
  const at = email.indexOf("@");
  if (at < 2) return "******";
  return `${email.slice(0, 2)}${"•".repeat(Math.min(6, Math.max(3, at - 2)))}${email.slice(at)}`;
}

function platformName(platform: string) {
  const normalized = platform.toLowerCase();
  if (normalized === "windows") return "Windows";
  if (normalized === "macos" || normalized === "darwin") return "macOS";
  if (normalized === "linux") return "Linux";
  return platform || "未知平台";
}

function loadRefreshMinutes() {
  const value = Number(localStorage.getItem(REFRESH_INTERVAL_KEY));
  return Number.isInteger(value) && value >= 1 && value <= 1440 ? value : 30;
}

function useRemoteModelRestartPrompt() {
  const dispatch = useAppDispatch();
  const { devices, restartingDeviceId } = useAppSelector((state) => state.data);
  return useCallback(async (deviceId: string) => {
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device?.capabilities?.includes("restart-codex")) {
      await Dialog.alert({
        title: "重启以加载当前模型？",
        content: "已在官方模型与第三方 Provider 间切换。请在目标 PC 上手动重启 ChatGPT/Codex。",
        confirmText: "知道了",
      });
      return;
    }
    const confirmed = await Dialog.confirm({
      title: "重启以加载当前模型？",
      content: "已在官方模型与第三方 Provider 间切换。立即重启目标 PC 上的 ChatGPT/Codex 以加载当前模型。",
      confirmText: "立即重启",
      cancelText: "稍后",
    });
    if (!confirmed || restartingDeviceId) return;
    try {
      await dispatch(restartDeviceCodex(deviceId)).unwrap();
      Toast.show({ icon: "success", content: "目标 PC 上的 ChatGPT/Codex 已重启" });
    } catch { /* The global error toast reports the failure. */ }
  }, [devices, dispatch, restartingDeviceId]);
}

function UsageMeter({ label, usage }: { label: string; usage?: UsageWindow | null }) {
  if (!usage) return <div className="usage-meter unavailable">
    <div className="usage-title-row"><span>{label}</span><strong>--</strong></div>
    <div className="meter-track" /><small>暂无用量数据</small>
  </div>;
  const remaining = Math.max(0, Math.min(100, Math.round(usage.remainingPercent)));
  const tone = remaining <= 15 ? "danger" : remaining <= 40 ? "warning" : "healthy";
  return <div className={`usage-meter ${tone}`}>
    <div className="usage-title-row"><span>{label}</span><strong>{remaining}% <em>剩余</em></strong></div>
    <div className="meter-track"><i style={{ width: `${remaining}%` }} /></div>
    <small>{resetLabel(usage.resetsAt)}</small>
  </div>;
}

function LoginView() {
  const dispatch = useAppDispatch();
  const { submitting, error } = useAppSelector((state) => state.auth);
  const [baseUrl, setBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      Toast.show({ icon: "fail", content: "请填写邮箱和密码" });
      return;
    }
    try {
      await dispatch(signIn({ baseUrl, email, password })).unwrap();
      Toast.show({ icon: "success", content: "欢迎回来" });
    } catch {
      // The Redux state renders the actionable server error.
    }
  };

  return <main className="login-page">
    <section className="login-story">
      <div className="story-grid" />
      <div className="brand-lockup light"><span className="brand-mark"><Zap size={21} fill="currentColor" /></span><b>Codex Switch</b></div>
      <div className="story-copy">
        <span className="eyebrow"><Sparkles size={14} /> 随时掌握每个账号</span>
        <h1>离开电脑，也能<br />从容切换。</h1>
        <p>一处查看账号用量、设备在线状态，并远程切换桌面端正在使用的账号。</p>
        <div className="story-points">
          <span><CircleGauge size={17} /> 实时用量</span>
          <span><MonitorCog size={17} /> 远程控制</span>
          <span><ShieldCheck size={17} /> JWT 安全认证</span>
        </div>
      </div>
      <small>Mobile first · Browser ready</small>
    </section>
    <section className="login-panel">
      <div className="mobile-login-brand brand-lockup"><span className="brand-mark"><Zap size={21} fill="currentColor" /></span><b>Codex Switch</b></div>
      <div className="login-form-wrap">
        <span className="login-kicker">账户中心</span>
        <h2>登录 Web 控制台</h2>
        <p className="login-intro">使用你的 Codex Switch 云端账号继续</p>
        <Form className="login-form" layout="vertical" footer={<Button block color="primary" size="large" loading={submitting} onClick={submit}>登录并查看</Button>}>
          <Form.Item label="邮箱">
            <Input value={email} onChange={(value) => { setEmail(value); dispatch(clearAuthError()); }}
              type="email" autoComplete="email" placeholder="name@example.com" clearable />
          </Form.Item>
          <Form.Item label="密码">
            <Input value={password} onChange={(value) => { setPassword(value); dispatch(clearAuthError()); }}
              type="password" autoComplete="current-password" placeholder="输入登录密码"
              onEnterPress={() => void submit()} clearable />
          </Form.Item>
          <button type="button" className="server-toggle" onClick={() => setShowServer((value) => !value)}>
            <Server size={15} /> {showServer ? "收起服务地址" : "连接其他服务器"} <ChevronRight size={14} />
          </button>
          {showServer ? <Form.Item label="云端服务器地址" help="自部署时填写 Kong 对外提供的 HTTPS 根地址">
            <Input value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com" clearable />
          </Form.Item> : null}
          {error ? <div className="form-error">{error}</div> : null}
        </Form>
        <div className="login-security"><ShieldCheck size={16} /><span>受保护接口由 Kong 校验 JWT，会话过期后自动安全续期。</span></div>
      </div>
    </section>
  </main>;
}

function AccountCard({ account, privateMode, onOpen, onSwitch }: {
  account: AccountSummary;
  privateMode: boolean;
  onOpen: () => void;
  onSwitch: () => void;
}) {
  const switching = useAppSelector((state) => state.data.switchingAccountId === account.id);
  const remaining = account.usage.primary
    ? Math.max(0, Math.min(100, Math.round(account.usage.primary.remainingPercent)))
    : null;
  return <Card className="account-card" onClick={onOpen}>
    <div className="account-topline">
      <span className={`plan-badge ${account.source === "system" ? "managed" : ""}`}>{account.plan || "ChatGPT"}</span>
      <button type="button" className="more-button" onClick={(event) => { event.stopPropagation(); onOpen(); }} aria-label="查看账号详情"><MoreHorizontal size={20} /></button>
    </div>
    <h3>{privateMode ? maskEmail(account.email) : account.email}</h3>
    <div className="account-usage-row">
      <div className={`usage-orb ${remaining !== null && remaining <= 20 ? "low" : ""}`}>
        <strong>{remaining === null ? "--" : remaining}</strong><span>{remaining === null ? "" : "%"}</span>
      </div>
      <div className="account-usage-copy">
        <span>主窗口剩余</span>
        <p>{account.usage.primary ? resetLabel(account.usage.primary.resetsAt) : "暂无实时数据"}</p>
      </div>
    </div>
    {account.usage.error ? <div className="account-refresh-error" role="alert">
      <CircleAlert size={14} />
      <div><strong>刷新失败</strong><span>{account.usage.error}</span></div>
    </div> : null}
    <div className="account-card-footer">
      <span className={account.active ? "active-account" : ""}>{account.active ? "当前活跃" : formatDate(account.usage.fetchedAt)}</span>
      <Button size="mini" color="primary" loading={switching} onClick={(event) => { event.stopPropagation(); onSwitch(); }}>切换到设备</Button>
    </div>
  </Card>;
}

function ResetCreditsPanel({ account, open, onClose, onConsumed }: {
  account: AccountSummary | null;
  open: boolean;
  onClose: () => void;
  onConsumed: () => void;
}) {
  const [credits, setCredits] = useState<ResetCredit[]>([]);
  const [loading, setLoading] = useState(false);
  const [consuming, setConsuming] = useState(false);
  useEffect(() => {
    if (!open || !account) return;
    setLoading(true);
    void fetchResetCredits(account.id).then((result) => setCredits(result.credits)).catch((error) => {
      Toast.show({ icon: "fail", content: messageOf(error) });
    }).finally(() => setLoading(false));
  }, [account, open]);

  const consume = async () => {
    if (!account) return;
    setConsuming(true);
    try {
      await consumeResetCredit(account.id);
      Toast.show({ icon: "success", content: "重置卡已使用" });
      onConsumed();
      onClose();
    } catch (error) {
      Toast.show({ icon: "fail", content: messageOf(error) });
    } finally {
      setConsuming(false);
    }
  };

  return <AdaptiveSheet open={open} title="用量重置卡" subtitle={account?.email} onClose={onClose}>
    {loading ? <div className="sheet-loading"><SpinLoading color="primary" /><span>正在查询重置卡</span></div>
      : !credits.length ? <Empty className="compact-empty" description="当前账号没有可用重置卡" />
        : <div className="credit-list">{credits.map((credit, index) => <div className="credit-card" key={`${credit.expiresAt}-${index}`}>
          <div className="credit-icon"><Sparkles size={20} /></div>
          <div><strong>Codex 用量重置卡</strong><span>有效期至 {formatDate(credit.expiresAt, true)}</span></div>
        </div>)}</div>}
    <Button block color="primary" size="large" disabled={!credits.length || loading} loading={consuming} onClick={consume}>使用一张重置卡</Button>
  </AdaptiveSheet>;
}

function AccountsPage() {
  const dispatch = useAppDispatch();
  const {
    accounts,
    devices,
    loading,
    refreshing,
    refreshingAccountId,
    switchingAccountId,
    lastRefreshAt,
  } = useAppSelector((state) => state.data);
  const promptModelRestart = useRemoteModelRestartPrompt();
  const [privateMode, setPrivateMode] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [switchId, setSwitchId] = useState<string | null>(null);
  const [creditsId, setCreditsId] = useState<string | null>(null);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const detail = accounts.find((item) => item.id === detailId) ?? null;
  const switchTarget = accounts.find((item) => item.id === switchId) ?? null;
  const creditsTarget = accounts.find((item) => item.id === creditsId) ?? null;
  const editTarget = accounts.find((item) => item.id === editAccountId) ?? null;
  const onlineDevices = devices.filter((device) => device.online);
  const performRefresh = useCallback(async () => {
    try { await dispatch(refreshAll()).unwrap(); }
    catch { /* The global error toast reports the failure. */ }
  }, [dispatch]);

  const content = <div className="page-body accounts-page">
    <header className="page-heading mobile-only"><div><span>账户中心</span><h1>账号用量</h1></div>
      <button className="icon-button" type="button" onClick={() => void performRefresh()} aria-label="刷新全部"><RefreshCw size={19} className={refreshing ? "spin" : ""} /></button>
    </header>
    <section className="overview-hero">
      <div className="hero-copy"><span>账户概览</span><h2>{accounts.length} 个账号，<br />都在掌控之中。</h2>
        <p>{onlineDevices.length} 台 PC 在线 · {lastRefreshAt ? `更新于 ${formatDate(new Date(lastRefreshAt).toISOString())}` : "尚未刷新"}</p></div>
      <div className="hero-stats"><div><strong>{accounts.length}</strong><span>账号</span></div><i /><div><strong>{onlineDevices.length}</strong><span>在线设备</span></div></div>
      <div className="hero-glow" />
    </section>
    <div className="section-toolbar"><div><h2>我的账号</h2><span>{accounts.length} 个已同步账号</span></div>
      <div className="account-toolbar-actions"><Button size="small" color="primary" onClick={() => setAddAccountOpen(true)}>＋ 添加账户</Button><div className="privacy-toggle"><span>{privateMode ? <EyeOff size={16} /> : <Eye size={16} />} 隐藏信息</span><Switch checked={privateMode} onChange={setPrivateMode} /></div></div></div>
    {loading ? <div className="page-loading"><SpinLoading color="primary" /><span>正在读取账户概览</span></div>
      : !accounts.length ? <Empty className="page-empty" description="暂无可展示的账号，请点击“添加账户”" />
        : <div className="account-grid">{accounts.map((account) => <AccountCard key={account.id} account={account} privateMode={privateMode}
          onOpen={() => setDetailId(account.id)} onSwitch={() => setSwitchId(account.id)} />)}</div>}
  </div>;

  return <>
    <PullToRefresh onRefresh={performRefresh} renderText={(status) => PULL_REFRESH_TEXT[status]}>{content}</PullToRefresh>
    <AdaptiveSheet open={Boolean(detail)} title="账号概览" subtitle={detail?.email} onClose={() => setDetailId(null)}>
      {detail ? <div className="account-detail">
        <div className="detail-identity"><span className="plan-badge">{detail.plan || "ChatGPT"}</span><h3>{detail.email}</h3><p>{detail.source === "system" ? "官方账号池绑定" : "个人同步账号"}</p></div>
        <UsageMeter label="主用量窗口" usage={detail.usage.primary} />
        <UsageMeter label="次用量窗口" usage={detail.usage.secondary} />
        {detail.usage.error ? <div className="inline-warning">{detail.usage.error}</div> : null}
        <div className="detail-note"><span>账号备注</span><p>{detail.note || "暂无备注"}</p></div>
        <div className="sheet-actions two"><Button block loading={refreshingAccountId === detail.id} onClick={async () => {
          try { await dispatch(refreshOneAccount(detail.id)).unwrap(); Toast.show({ icon: "success", content: "用量已刷新" }); }
          catch { /* Global toast */ }
        }}><RefreshCw size={16} />刷新用量</Button><Button block color="primary" onClick={() => setCreditsId(detail.id)}><Sparkles size={16} />重置卡</Button></div>
        <Button block fill="outline" onClick={() => { setDetailId(null); setEditAccountId(detail.id); }}>编辑账号信息</Button>
      </div> : null}
    </AdaptiveSheet>
    <AccountDetailsSheet account={editTarget} onClose={() => setEditAccountId(null)} onUpdated={async () => { await performRefresh(); }} />
    <AddAccountSheet open={addAccountOpen} onClose={() => setAddAccountOpen(false)} onAdded={performRefresh} />
    <AdaptiveSheet open={Boolean(switchTarget)} title="选择目标设备" subtitle={switchTarget ? `切换到 ${switchTarget.email}` : undefined} onClose={() => setSwitchId(null)}>
      {!onlineDevices.length ? <Empty className="compact-empty" description="当前没有在线 PC 设备" />
        : <div className="select-list">{onlineDevices.map((device) => {
          const current = !device.activeProviderId && device.activeAccountId === switchTarget?.id;
          const switching = switchingAccountId === switchTarget?.id;
          return <button type="button" key={device.deviceId} disabled={current || switching}
            onClick={async () => {
              try {
                const result = await dispatch(switchDeviceAccount({
                  deviceId: device.deviceId,
                  accountId: switchTarget!.id,
                })).unwrap();
                Toast.show({ icon: "success", content: `${device.name} 已切换到官方模型` });
                setSwitchId(null);
                if (result.result.requiresRestart) {
                  window.setTimeout(() => void promptModelRestart(device.deviceId), 0);
                }
              } catch { /* Global toast */ }
            }}><span className="device-mini-icon"><Laptop size={19} /></span><span>
              <strong>{device.name}</strong><small>{platformName(device.platform)} · 在线</small></span>
            {current ? <b className="current-pill">当前</b> : <ChevronRight size={18} />}
          </button>;
        })}</div>}
    </AdaptiveSheet>
    <ResetCreditsPanel account={creditsTarget} open={Boolean(creditsTarget)} onClose={() => setCreditsId(null)} onConsumed={() => void performRefresh()} />
  </>;
}

function DevicesPage() {
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
  const onlineCount = devices.filter((item) => item.online).length;
  const performRefresh = useCallback(async () => {
    try { await dispatch(refreshAll()).unwrap(); }
    catch { /* The global error toast reports the failure. */ }
  }, [dispatch]);

  const deleteDevice = async (device: RemoteDevice) => {
    const confirmed = await Dialog.confirm({
      title: "删除这台设备？",
      content: `“${device.name}”再次登录桌面端后仍会重新出现在这里。`,
      confirmText: "删除设备",
    });
    if (!confirmed) return;
    try {
      await dispatch(removeDevice(device.deviceId)).unwrap();
      Toast.show({ icon: "success", content: "设备已删除" });
    } catch { /* Global toast */ }
  };

  const switchOfficialModel = async (deviceId: string, accountId: string) => {
    try {
      const result = await dispatch(switchDeviceAccount({ deviceId, accountId })).unwrap();
      Toast.show({ icon: "success", content: "已切换到官方模型" });
      if (result.result.requiresRestart) {
        window.setTimeout(() => void promptModelRestart(deviceId), 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  const switchProviderModel = async (deviceId: string, providerId: string) => {
    try {
      const result = await dispatch(switchDeviceProvider({ deviceId, providerId })).unwrap();
      Toast.show({ icon: "success", content: "已切换到第三方 Provider" });
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
      Toast.show({ icon: "success", content: `已启动分组“${group}”` });
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
      <div className="page-body devices-page">
        <header className="page-heading"><div><span>实时连接</span><h1>设备管理</h1></div>
          <button className="icon-button" type="button" onClick={() => void dispatch(refreshAll())}
            aria-label="刷新设备">
            <RefreshCw size={19} className={refreshing ? "spin" : ""} />
          </button>
        </header>
        <section className="device-summary">
          <div className="summary-icon"><Wifi size={24} /></div>
          <div><strong>{onlineCount}</strong><span>台设备当前在线</span></div>
          <div className="live-pill"><i /> 实时更新</div>
        </section>
        <div className="section-toolbar"><div><h2>已登录设备</h2><span>共 {devices.length} 台 PC</span></div></div>
        {!devices.length ? <Empty className="page-empty" description="登录桌面端后，设备会出现在这里" />
          : <div className="device-grid">{sorted.map((device) => {
            const activeAccount = accounts.find((item) => item.id === device.activeAccountId);
            const activeProvider = providers.find((item) => item.id === device.activeProviderId);
            const authAccount = accounts.find((item) => item.id === device.openaiAuthAccountId);
            const currentModel = device.activeProviderGroup
              ? `分组 · ${device.activeProviderGroup}`
              : device.activeProviderId
                ? `${activeProvider?.name || "第三方 Provider"}${
                  activeProvider?.model ? ` · ${activeProvider.model}` : ""
                }`
                : activeAccount ? `官方 · ${activeAccount.email}` : "未选择";
            return <Card key={device.deviceId} className={`device-card ${device.online ? "online" : "offline"}`}>
              <div className="device-card-header"><span className="device-platform"><Laptop size={22} /></span>
                <div><h3>{device.name}</h3>
                  <p>{platformName(device.platform)}{device.appVersion ? ` · v${device.appVersion}` : ""}</p></div>
                <span className="status-badge"><i />{device.online ? "在线" : "离线"}</span></div>
              <div className="device-data">
                <div><span>当前模型</span><strong>{currentModel}</strong></div>
                <div><span>官方账号</span><strong>{activeAccount?.email || "未选择"}</strong></div>
                <div><span>代理登录态</span><strong>{authAccount?.email || "未选择"}</strong></div>
                <div><span>最后在线</span>
                  <strong>{device.online ? "当前在线" : formatDate(device.lastSeenAt, true)}</strong></div>
              </div>
              <Button block size="small" color="primary" className="device-model-action"
                disabled={!device.online} onClick={() => setModelDeviceId(device.deviceId)}>
                切换模型
              </Button>
              <div className="device-actions">
                <Button block size="small" disabled={device.online}
                  loading={deletingDeviceId === device.deviceId} onClick={() => void deleteDevice(device)}>
                  {device.online ? "在线不可删除" : "删除设备"}
                </Button>
                <Button block size="small" disabled={!device.online}
                  loading={switchingOpenAiAuth?.deviceId === device.deviceId}
                  onClick={() => setAuthDeviceId(device.deviceId)}>
                  代理登录态
                </Button>
              </div>
            </Card>;
          })}</div>}
      </div>
    </PullToRefresh>
    <RemoteModelSwitchSheet
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
    <AdaptiveSheet open={Boolean(authDevice)} title="代理登录态账号"
      subtitle={authDevice ? `${authDevice.name} · 选择后会重启 ChatGPT/Codex` : undefined}
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
              Toast.show({ icon: "success", content: "代理登录态已更新" });
              setAuthDeviceId(null);
            } catch { /* Global toast */ }
          }}>
          <span className="account-initial">{account.email.slice(0, 2).toUpperCase()}</span>
          <span><strong>{account.email}</strong><small>{account.plan || "ChatGPT"}</small></span>
          {current ? <b className="current-pill">当前</b> : <ChevronRight size={18} />}
        </button>;
      })}</div>
    </AdaptiveSheet>
  </>;
}

function SettingsPage() {
  const dispatch = useAppDispatch();
  const { session } = useAppSelector((state) => state.auth);
  const profile = useAppSelector((state) => state.data.profile);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [refreshMinutes, setRefreshMinutes] = useState(() => String(loadRefreshMinutes()));
  const email = profile?.email || session?.email || "";
  const roleName = profile?.roleName || (profile?.role === "admin" ? "管理员" : "用户");

  const savePassword = async () => {
    if (currentPassword.length < 6 || newPassword.length < 8 || newPassword !== confirmPassword) {
      Toast.show({ icon: "fail", content: newPassword !== confirmPassword ? "两次输入的新密码不一致" : "请检查密码长度" });
      return;
    }
    setSavingPassword(true);
    try {
      await apiJson("/admin/api/profile/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) });
      Toast.show({ icon: "success", content: "密码已修改" });
      setPasswordOpen(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (error) {
      Toast.show({ icon: "fail", content: messageOf(error) });
    } finally { setSavingPassword(false); }
  };

  const confirmLogout = async () => {
    const confirmed = await Dialog.confirm({ title: "退出当前账号？", content: "本机保存的 Web 会话将被清除，云端数据不会受到影响。", confirmText: "退出登录" });
    if (confirmed) void dispatch(signOut());
  };

  const saveRefresh = () => {
    const minutes = Number(refreshMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      Toast.show({ icon: "fail", content: "请输入 1 到 1440 之间的整数分钟" });
      return;
    }
    localStorage.setItem(REFRESH_INTERVAL_KEY, String(minutes));
    window.dispatchEvent(new Event("codex-switch:refresh-interval"));
    Toast.show({ icon: "success", content: `已设置为每 ${minutes} 分钟刷新` });
  };

  return <>
    <div className="page-body settings-page">
      <header className="page-heading"><div><span>偏好与安全</span><h1>设置</h1></div></header>
      <section className="profile-card"><div className="profile-avatar">{email.slice(0, 2).toUpperCase()}</div><div><h2>{email}</h2><p>Codex Switch 云端账号</p></div><span>{roleName}</span></section>
      <div className="settings-columns">
        <section><div className="settings-section-title"><h2>账户与安全</h2><p>管理登录信息和控制台入口</p></div>
          <List className="settings-list">
            <List.Item prefix={<KeyRound size={19} />} description="验证当前密码后设置新密码" onClick={() => setPasswordOpen(true)} arrow>修改登录密码</List.Item>
            {profile?.role === "admin" ? <List.Item prefix={<ShieldCheck size={19} />} description="前往完整桌面管理后台" onClick={() => window.location.assign(`${session?.baseUrl ?? window.location.origin}/admin`)} arrow>管理员控制台</List.Item> : null}
            <List.Item prefix={<LogOut size={19} />} description="清除这台浏览器上的登录会话" onClick={() => void confirmLogout()} arrow>退出登录</List.Item>
          </List>
        </section>
        <section><div className="settings-section-title"><h2>刷新设置</h2><p>控制用量数据自动更新频率</p></div>
          <Card className="refresh-setting-card"><div className="setting-icon"><RefreshCw size={20} /></div><div className="setting-copy"><strong>全局自动刷新</strong><span>范围 1–1440 分钟，默认 30 分钟</span></div>
            <div className="interval-input"><Input value={refreshMinutes} onChange={(value) => setRefreshMinutes(value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" /><span>分钟</span><Button size="small" color="primary" onClick={saveRefresh}>保存</Button></div></Card>
        </section>
      </div>
      <section className="about-card"><span className="brand-mark"><Zap size={19} fill="currentColor" /></span><div><strong>Codex Switch Web</strong><p>移动端优先，桌面浏览器同样顺手。</p></div><a href="https://github.com/piperhex/codex-switch" target="_blank" rel="noreferrer">开源项目 <ExternalLink size={14} /></a></section>
      <p className="security-footnote"><ShieldCheck size={15} /> 访问令牌仅保存在当前浏览器中，请勿在公共设备上保持登录。</p>
    </div>
    <AdaptiveSheet open={passwordOpen} title="修改登录密码" subtitle="新密码至少 8 位" onClose={() => setPasswordOpen(false)}>
      <Form layout="vertical" className="password-form" footer={<Button block color="primary" size="large" loading={savingPassword} onClick={() => void savePassword()}>确认修改</Button>}>
        <Form.Item label="当前密码"><Input type="password" value={currentPassword} onChange={setCurrentPassword} placeholder="输入当前密码" /></Form.Item>
        <Form.Item label="新密码"><Input type="password" value={newPassword} onChange={setNewPassword} placeholder="至少 8 位" /></Form.Item>
        <Form.Item label="确认新密码"><Input type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="再次输入新密码" /></Form.Item>
      </Form>
    </AdaptiveSheet>
  </>;
}

const navItems: Array<{ key: AppPage; label: string; icon: typeof LayoutDashboard }> = [
  { key: "accounts", label: "账号", icon: LayoutDashboard },
  { key: "devices", label: "设备", icon: Laptop },
  { key: "totp", label: "2FA", icon: ShieldCheck },
  { key: "settings", label: "设置", icon: Settings },
];

function AppShell() {
  const dispatch = useAppDispatch();
  const { session } = useAppSelector((state) => state.auth);
  const { page, profile, devices, refreshing, lastRefreshAt, error } = useAppSelector((state) => state.data);
  const lastRefreshRef = useRef(Date.now());
  const onlineCount = devices.filter((item) => item.online).length;

  useEffect(() => {
    if (!error) return;
    Toast.show({ icon: "fail", content: error });
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
    window.addEventListener("codex-switch:refresh-interval", schedule);
    return () => { window.clearInterval(intervalId); window.removeEventListener("codex-switch:refresh-interval", schedule); };
  }, [dispatch, session]);

  const userMenu: MenuProps["items"] = [
    { key: "settings", label: "账户设置", icon: <Settings size={16} />, onClick: () => dispatch(pageChanged("settings")) },
    ...(profile?.role === "admin" ? [{ key: "admin", label: "管理员控制台", icon: <ShieldCheck size={16} />, onClick: () => window.location.assign(`${session?.baseUrl ?? window.location.origin}/admin`) }] : []),
    { type: "divider" as const },
    { key: "logout", label: "退出登录", danger: true, icon: <LogOut size={16} />, onClick: () => void dispatch(signOut()) },
  ];

  return <div className="app-shell">
    <aside className="desktop-sidebar">
      <div className="brand-lockup"><span className="brand-mark"><Zap size={21} fill="currentColor" /></span><b>Codex Switch</b></div>
      <nav>{navItems.map((item) => <button key={item.key} type="button" className={page === item.key ? "active" : ""} onClick={() => dispatch(pageChanged(item.key))}><item.icon size={19} /><span>{item.label}</span>{item.key === "devices" && onlineCount ? <b>{onlineCount}</b> : null}</button>)}</nav>
      <div className="sidebar-live"><span><i /> 服务已连接</span><p>JWT 会话受 Kong 保护</p></div>
      <Dropdown menu={{ items: userMenu }} trigger={["click"]}><button type="button" className="sidebar-profile"><span>{(profile?.email || session?.email || "U").slice(0, 2).toUpperCase()}</span><div><strong>{profile?.email || session?.email}</strong><small>{profile?.roleName || (profile?.role === "admin" ? "管理员" : "用户")}</small></div><Menu size={17} /></button></Dropdown>
    </aside>
    <div className="content-shell">
      <header className="desktop-topbar"><div><span>{navItems.find((item) => item.key === page)?.label}</span><strong>{page === "accounts" ? "欢迎回来，今天也保持从容。" : page === "devices" ? "查看并控制你的桌面设备。" : page === "totp" ? "管理并同步你的 2FA 验证码。" : "管理偏好与账户安全。"}</strong></div>
        <div><Tooltip title="刷新全部数据"><button className="icon-button" type="button" onClick={() => void dispatch(refreshAll())}><RefreshCw size={18} className={refreshing ? "spin" : ""} /></button></Tooltip><span className="topbar-date">{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</span></div></header>
      <main className="main-content">{page === "accounts" ? <AccountsPage /> : page === "devices" ? <DevicesPage /> : page === "totp" ? <TotpPage /> : <SettingsPage />}</main>
    </div>
    <div className="mobile-tabbar"><TabBar activeKey={page} onChange={(key) => dispatch(pageChanged(key as AppPage))}>{navItems.map((item) => <TabBar.Item key={item.key} title={item.label} icon={<item.icon size={21} />} badge={item.key === "devices" && onlineCount ? onlineCount : undefined} />)}</TabBar><SafeArea position="bottom" /></div>
  </div>;
}

export default function App() {
  const dispatch = useAppDispatch();
  const { session, initialized } = useAppSelector((state) => state.auth);
  useEffect(() => { void dispatch(bootstrapApp()); }, [dispatch]);
  if (!initialized) return <div className="boot-screen"><span className="brand-mark"><Zap size={22} fill="currentColor" /></span><SpinLoading color="primary" /><p>正在打开 Codex Switch</p></div>;
  return session ? <AppShell /> : <LoginView />;
}
