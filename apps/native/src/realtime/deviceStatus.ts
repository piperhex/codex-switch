import type { AuthSession, RemoteDevice } from '../types';

export type DeviceStatusSocketMessage =
  | { type: 'devices-snapshot'; devices: RemoteDevice[] }
  | { type: 'device-online'; device: RemoteDevice }
  | { type: 'device-offline'; deviceId: string; lastSeenAt: string }
  | { type: 'device-removed'; deviceId: string };

export function deviceStatusWebSocketUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else throw new Error('设备状态服务地址必须使用 HTTP 或 HTTPS');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/device-switch`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function deviceStatusSubscriptionMessage(session: AuthSession) {
  return JSON.stringify({
    type: 'subscribe-devices',
    accessToken: session.accessToken,
  });
}

export function parseDeviceStatusSocketMessage(value: unknown): DeviceStatusSocketMessage | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const message = parsed as Record<string, unknown>;
  if (message.type === 'devices-snapshot' && Array.isArray(message.devices)) {
    const devices = message.devices.map(remoteDevice).filter((device) => device !== null);
    return { type: 'devices-snapshot', devices };
  }
  if (message.type === 'device-online') {
    const device = remoteDevice(message.device);
    return device ? { type: 'device-online', device: { ...device, online: true } } : null;
  }
  if (
    message.type === 'device-offline'
    && typeof message.deviceId === 'string'
    && typeof message.lastSeenAt === 'string'
  ) {
    return {
      type: 'device-offline',
      deviceId: message.deviceId,
      lastSeenAt: message.lastSeenAt,
    };
  }
  if (message.type === 'device-removed' && typeof message.deviceId === 'string') {
    return { type: 'device-removed', deviceId: message.deviceId };
  }
  return null;
}

export function applyDeviceStatusSocketMessage(
  current: RemoteDevice[],
  message: DeviceStatusSocketMessage,
): RemoteDevice[] {
  if (message.type === 'devices-snapshot') {
    const snapshotIds = new Set(message.devices.map((device) => device.deviceId));
    return [
      ...message.devices,
      ...current.filter((device) => !snapshotIds.has(device.deviceId)),
    ];
  }
  if (message.type === 'device-online') {
    return [
      message.device,
      ...current.filter((device) => device.deviceId !== message.device.deviceId),
    ];
  }
  if (message.type === 'device-removed') {
    return current.filter((device) => device.deviceId !== message.deviceId);
  }
  const offline = current.find((device) => device.deviceId === message.deviceId);
  if (!offline) return current;
  return [
    { ...offline, online: false, lastSeenAt: message.lastSeenAt },
    ...current.filter((device) => device.deviceId !== message.deviceId),
  ];
}

function remoteDevice(value: unknown): RemoteDevice | null {
  if (!value || typeof value !== 'object') return null;
  const device = value as Record<string, unknown>;
  if (
    typeof device.deviceId !== 'string'
    || typeof device.name !== 'string'
    || typeof device.platform !== 'string'
    || typeof device.lastSeenAt !== 'string'
    || typeof device.online !== 'boolean'
  ) return null;
  return {
    deviceId: device.deviceId,
    name: device.name,
    platform: device.platform,
    appVersion: typeof device.appVersion === 'string' ? device.appVersion : null,
    activeAccountId: typeof device.activeAccountId === 'string' ? device.activeAccountId : null,
    openaiAuthAccountId: typeof device.openaiAuthAccountId === 'string'
      ? device.openaiAuthAccountId
      : null,
    activeProviderId: typeof device.activeProviderId === 'string' ? device.activeProviderId : null,
    localProxyRunning: device.localProxyRunning === true,
    capabilities: remoteControlCapabilities(device.capabilities),
    lastSeenAt: device.lastSeenAt,
    online: device.online,
  };
}

function remoteControlCapabilities(value: unknown): RemoteDevice['capabilities'] {
  if (!Array.isArray(value)) return [];
  return value.filter((capability): capability is RemoteDevice['capabilities'][number] => (
    capability === 'provider-switch' || capability === 'restart-codex'
  ));
}
