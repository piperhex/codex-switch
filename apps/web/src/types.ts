export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number | null;
  windowMinutes?: number | null;
}

export interface UsageSummary {
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
  apiExpiresAt?: string | null;
  plan?: string | null;
  fetchedAt?: string | null;
  error?: string | null;
}

export interface AccountSummary {
  id: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  active: boolean;
  usage: UsageSummary;
  lastModifiedAt?: string;
  source?: "personal" | "system";
}

export type RemoteControlCapability = 'provider-switch' | 'restart-codex';

export interface RemoteDevice {
  deviceId: string;
  name: string;
  platform: string;
  appVersion?: string | null;
  activeAccountId?: string | null;
  openaiAuthAccountId?: string | null;
  activeProviderId?: string | null;
  localProxyRunning: boolean;
  capabilities: RemoteControlCapability[];
  lastSeenAt: string;
  online: boolean;
}

export interface RemoteProviderSummary {
  id: string;
  name: string;
  model: string;
}

export interface RemoteModelSwitchResult {
  deviceId: string;
  activeAccountId?: string | null;
  activeProviderId?: string | null;
  requiresRestart: boolean;
  online: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  role: string;
  roleName?: string;
  permissions?: string[];
}

export interface AuthSession {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  profile?: UserProfile;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user?: UserProfile;
}

export interface ResetCredit {
  issuedAt?: string | null;
  expiresAt?: string | null;
}

export interface ResetCreditsSummary {
  credits: ResetCredit[];
}

export type AppPage = "accounts" | "devices" | "settings";

export type DeviceStatusSocketMessage =
  | { type: "devices-snapshot"; devices: RemoteDevice[] }
  | { type: "device-online"; device: RemoteDevice }
  | { type: "device-offline"; deviceId: string; lastSeenAt: string }
  | { type: "device-removed"; deviceId: string };
