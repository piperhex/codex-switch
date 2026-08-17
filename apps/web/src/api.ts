import type {
  AccountSummary,
  AuthResponse,
  AuthSession,
  DeviceStatusSocketMessage,
  RemoteDevice,
  RemoteModelSwitchResult,
  RemoteProviderSummary,
  ResetCreditsSummary,
  UsageSummary,
  UserProfile,
} from "./types";

const SESSION_KEY = "codex-switch.web.session.v1";
const API_BASE_FROM_ENV = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

let activeSession: AuthSession | null = null;
let refreshRequest: Promise<AuthSession> | null = null;
const sessionListeners = new Set<(session: AuthSession | null) => void>();

export function defaultApiBaseUrl() {
  return normalizeBaseUrl(API_BASE_FROM_ENV || window.location.origin);
}

export function normalizeBaseUrl(value: string) {
  const raw = value.trim() || window.location.origin;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入有效的服务地址，例如 https://api.example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("服务地址仅支持 HTTP 或 HTTPS");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.baseUrl || !parsed.accessToken || !parsed.refreshToken || !parsed.email) return null;
    activeSession = parsed as AuthSession;
    return activeSession;
  } catch {
    return null;
  }
}

export function getActiveSession() {
  return activeSession;
}

export function setActiveSession(session: AuthSession | null) {
  activeSession = session;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  sessionListeners.forEach((listener) => listener(session));
}

export function subscribeSession(listener: (session: AuthSession | null) => void) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (Array.isArray(payload?.message)) return payload.message.join("；");
  return payload?.message || `请求失败（HTTP ${response.status}）`;
}

async function refreshSession() {
  if (refreshRequest) return refreshRequest;
  const session = activeSession;
  if (!session?.refreshToken) throw new Error("登录已过期，请重新登录");
  refreshRequest = fetch(`${session.baseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  }).then(async (response) => {
    if (!response.ok) {
      setActiveSession(null);
      throw new Error("登录已过期，请重新登录");
    }
    const payload = await response.json() as AuthResponse;
    if (!payload.accessToken || !payload.refreshToken) throw new Error("刷新登录状态失败");
    const next = { ...session, accessToken: payload.accessToken, refreshToken: payload.refreshToken };
    setActiveSession(next);
    return next;
  }).finally(() => {
    refreshRequest = null;
  });
  return refreshRequest;
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const request = async (session: AuthSession) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(`${session.baseUrl}${path}`, { ...init, headers });
  };
  const session = activeSession;
  if (!session) throw new Error("请先登录");
  let response = await request(session);
  if (response.status !== 401) return response;
  response = await request(await refreshSession());
  if (response.status === 401) {
    setActiveSession(null);
    throw new Error("登录已过期，请重新登录");
  }
  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authorizedFetch(path, init);
  if (!response.ok) throw new Error(await responseError(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function login(baseUrl: string, email: string, password: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${normalizedBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json() as AuthResponse;
  if (!payload.accessToken || !payload.refreshToken) throw new Error("服务器返回的登录信息无效");
  const session: AuthSession = {
    baseUrl: normalizedBaseUrl,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    email: payload.user?.email ?? email.trim(),
    profile: payload.user,
  };
  setActiveSession(session);
  return session;
}

export async function logout() {
  const session = activeSession;
  if (session?.refreshToken) {
    await fetch(`${session.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => undefined);
  }
  setActiveSession(null);
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchDashboardData(refreshUsage = true) {
  const [{ accounts }, devicesPayload, { providers }, profile] = await Promise.all([
    apiJson<{ accounts: AccountSummary[] }>("/sync/accounts/web-summary"),
    apiJson<{ devices: RemoteDevice[] }>("/devices"),
    apiJson<{ providers: RemoteProviderSummary[] }>("/devices/providers"),
    apiJson<UserProfile>("/auth/me"),
  ]);
  const devices = devicesPayload.devices.map(normalizeRemoteDevice);
  if (!refreshUsage) return { accounts, devices, providers, profile };
  const refreshedAccounts = await mapWithConcurrency(accounts, 4, async (account) => {
    try {
      const usage = await apiJson<UsageSummary>(`/sync/accounts/${encodeURIComponent(account.id)}/usage`);
      return { ...account, plan: usage.plan ?? account.plan, usage };
    } catch (error) {
      return {
        ...account,
        usage: {
          ...account.usage,
          fetchedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "用量刷新失败",
        },
      };
    }
  });
  return { accounts: refreshedAccounts, devices, providers, profile };
}

export function deviceStatusWebSocketUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/device-switch`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function parseDeviceStatusMessage(value: unknown): DeviceStatusSocketMessage | null {
  if (typeof value !== "string") return null;
  try {
    const message = JSON.parse(value) as DeviceStatusSocketMessage;
    if (message.type === "devices-snapshot" && Array.isArray(message.devices)) {
      return { ...message, devices: message.devices.map(normalizeRemoteDevice) };
    }
    if (message.type === "device-online" && message.device?.deviceId) {
      return { ...message, device: normalizeRemoteDevice(message.device) };
    }
    if (message.type === "device-offline" && message.deviceId) return message;
    if (message.type === "device-removed" && message.deviceId) return message;
  } catch {
    return null;
  }
  return null;
}

export async function refreshAccountUsage(accountId: string) {
  return apiJson<UsageSummary>(`/sync/accounts/${encodeURIComponent(accountId)}/usage`);
}

export async function fetchResetCredits(accountId: string) {
  return apiJson<ResetCreditsSummary>(`/sync/accounts/${encodeURIComponent(accountId)}/reset-credits`);
}

export async function consumeResetCredit(accountId: string) {
  return apiJson<{ ok: true }>(`/sync/accounts/${encodeURIComponent(accountId)}/reset-credits/consume`, {
    method: "POST",
  });
}

export async function switchRemoteDeviceProvider(deviceId: string, providerId: string) {
  return apiJson<RemoteModelSwitchResult>(
    `/devices/${encodeURIComponent(deviceId)}/provider`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    },
  );
}

export async function restartRemoteDeviceCodex(deviceId: string) {
  await apiJson<{ deviceId: string; restarted: boolean }>(
    `/devices/${encodeURIComponent(deviceId)}/restart-codex`,
    { method: "POST" },
  );
}

function normalizeRemoteDevice(device: RemoteDevice): RemoteDevice {
  return {
    ...device,
    activeProviderId: device.activeProviderId ?? null,
    localProxyRunning: device.localProxyRunning === true,
    capabilities: Array.isArray(device.capabilities)
      ? device.capabilities.filter((capability) => (
        capability === "provider-switch" || capability === "restart-codex"
      ))
      : [],
  };
}
