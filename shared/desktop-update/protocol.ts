export const DESKTOP_UPDATE_CAPABILITY = 'app-update';
export type UpdateAction = 'status' | 'check' | 'install';
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error';
export interface DesktopUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  notes: string | null;
  phase: UpdatePhase;
  progress: number | null;
  error: string | null;
}
export interface UpdateDevice {
  deviceId: string;
  name: string;
  platform: string;
  online: boolean;
  appVersion?: string | null;
  capabilities?: string[];
}
export const UPDATE_MESSAGES = {
  idle: '点击“检查更新”查看是否有新版本。',
  checking: '正在检查更新…',
  available: '有新版本可安装。',
  latest: '电脑端已是最新版本。',
  downloading: '电脑正在下载更新…',
  installing: '电脑正在安装更新，连接可能暂时中断。',
  reconnecting: '正在等待电脑重新连接，请稍后查看版本。',
  error: '更新未完成，请重试。',
  offline: '电脑已离线，请打开电脑端后重试。',
  unsupported: '请先在电脑上更新 Codex Switch，再使用远程更新。',
  disconnected: '连接已断开，请重新连接后查看结果。',
  timeout: '电脑暂未响应，请重试；已发送的安装指令可能仍在执行。',
  failed: '操作未完成，请稍后重试。',
} as const;

export function isUpdateBusy(status: DesktopUpdateStatus | null) {
  return !!status && ['checking', 'downloading', 'installing'].includes(status.phase);
}

export function parseUpdateStatus(value: unknown): DesktopUpdateStatus | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<DesktopUpdateStatus>;
  if (typeof data.currentVersion !== 'string' || data.currentVersion.length > 80
    || !['idle', 'checking', 'available', 'downloading', 'installing', 'error'].includes(data.phase ?? '')
    || !(data.latestVersion === null || typeof data.latestVersion === 'string')
    || !(data.notes === null || typeof data.notes === 'string')
    || !(data.error === null || typeof data.error === 'string')
    || !(data.progress === null || (typeof data.progress === 'number'
      && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 100))) return null;
  return data as DesktopUpdateStatus;
}
