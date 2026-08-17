import { randomUUID } from 'crypto';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { RawData } from 'ws';
import WebSocket from 'ws';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import { getKongJwtSecret } from '@/config/auth-secrets';
import type { ConfigModuleOptions } from '@/config/config.types';
import { UserService } from '@/modules/user/user.service';
import { DeviceControlService } from './device-control.service';

interface AccessPayload {
  sub: string;
}

interface AuthMessage {
  type: 'authenticate';
  accessToken: string;
  deviceId: string;
  name: string;
  platform: string;
  appVersion?: string;
  activeAccountId?: string | null;
  openaiAuthAccountId?: string | null;
  activeProviderId?: string | null;
  localProxyRunning?: boolean;
  capabilities?: string[];
}

interface SubscribeDevicesMessage {
  type: 'subscribe-devices';
  accessToken: string;
}

interface SwitchResultMessage {
  type: 'switch-result';
  commandId: string;
  success: boolean;
  error?: string;
}

interface DeviceSession {
  kind: 'device';
  ownerId: string;
  deviceId: string;
}

interface DeviceSubscriberSession {
  kind: 'device-subscriber';
  ownerId: string;
}

type ClientSession = DeviceSession | DeviceSubscriberSession;

interface RemoteDeviceStatus {
  deviceId: string;
  name: string;
  platform: string;
  appVersion?: string | null;
  activeAccountId?: string | null;
  openaiAuthAccountId?: string | null;
  activeProviderId?: string | null;
  localProxyRunning: boolean;
  capabilities: string[];
  lastSeenAt: string;
  online: boolean;
}

type RemoteCommand =
  | { type: 'switch-account'; accountId: string }
  | { type: 'set-openai-auth-account'; accountId: string }
  | { type: 'switch-provider'; providerId: string }
  | { type: 'restart-codex' };

interface PendingCommand {
  ownerId: string;
  deviceId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

@WebSocketGateway({ path: '/device-switch' })
export class DeviceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly sessions = new Map<WebSocket, ClientSession>();
  private readonly sockets = new Map<string, WebSocket>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly authTimers = new Map<WebSocket, NodeJS.Timeout>();
  private readonly deviceSubscribers = new Map<string, Set<WebSocket>>();
  private readonly heartbeatTimers = new Map<WebSocket, NodeJS.Timeout>();
  private readonly heartbeatClients = new Set<WebSocket>();

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UserService,
    private readonly devices: DeviceControlService,
    @Inject(MODULE_OPTIONS_TOKEN) private readonly config: ConfigModuleOptions,
  ) {}

  handleConnection(client: WebSocket) {
    const authTimer = setTimeout(() => client.close(4001, 'Authentication timed out'), 10_000);
    this.authTimers.set(client, authTimer);
    this.heartbeatClients.add(client);
    client.on('pong', () => this.heartbeatClients.add(client));
    const heartbeatTimer = setInterval(() => {
      if (!this.heartbeatClients.delete(client)) {
        client.terminate();
        return;
      }
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.ping();
        } catch {
          client.terminate();
        }
      }
    }, 25_000);
    heartbeatTimer.unref();
    this.heartbeatTimers.set(client, heartbeatTimer);
    client.on('message', (raw) => {
      void this.handleMessage(client, raw).catch(() => client.close(4001, 'Invalid message'));
    });
    client.once('close', () => {
      clearTimeout(authTimer);
      clearInterval(heartbeatTimer);
      this.heartbeatTimers.delete(client);
      this.heartbeatClients.delete(client);
    });
  }

  handleDisconnect(client: WebSocket) {
    const session = this.sessions.get(client);
    const authTimer = this.authTimers.get(client);
    const heartbeatTimer = this.heartbeatTimers.get(client);
    if (authTimer) clearTimeout(authTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    this.authTimers.delete(client);
    this.heartbeatTimers.delete(client);
    this.heartbeatClients.delete(client);
    this.sessions.delete(client);
    if (session?.kind === 'device-subscriber') {
      const subscribers = this.deviceSubscribers.get(session.ownerId);
      subscribers?.delete(client);
      if (subscribers?.size === 0) this.deviceSubscribers.delete(session.ownerId);
      return;
    }
    if (
      session?.kind === 'device'
      && this.sockets.get(this.socketKey(session.ownerId, session.deviceId)) === client
    ) {
      this.sockets.delete(this.socketKey(session.ownerId, session.deviceId));
      const lastSeenAt = new Date().toISOString();
      void this.devices.touch(session.deviceId).catch(() => undefined);
      this.broadcastToDeviceSubscribers(session.ownerId, {
        type: 'device-offline',
        deviceId: session.deviceId,
        lastSeenAt,
      });
    }
    for (const [commandId, pending] of this.pending) {
      if (
        session?.kind !== 'device'
        || pending.ownerId !== session.ownerId
        || pending.deviceId !== session.deviceId
      ) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error('Device disconnected before the command completed'));
      this.pending.delete(commandId);
    }
  }

  isOnline(ownerId: string, deviceId: string) {
    const socket = this.sockets.get(this.socketKey(ownerId, deviceId));
    const session = socket ? this.sessions.get(socket) : undefined;
    return socket?.readyState === WebSocket.OPEN
      && session?.kind === 'device'
      && session.ownerId === ownerId;
  }

  notifyDeviceRemoved(ownerId: string, deviceId: string) {
    this.broadcastToDeviceSubscribers(ownerId, {
      type: 'device-removed',
      deviceId,
    });
  }

  async pushAccountSwitch(ownerId: string, deviceId: string, accountId: string) {
    await this.pushCommand(ownerId, deviceId, { type: 'switch-account', accountId });
  }

  async pushOpenAiAuthAccountSwitch(ownerId: string, deviceId: string, accountId: string) {
    await this.pushCommand(ownerId, deviceId, { type: 'set-openai-auth-account', accountId });
  }

  async pushProviderSwitch(ownerId: string, deviceId: string, providerId: string) {
    await this.pushCommand(ownerId, deviceId, { type: 'switch-provider', providerId });
  }

  async pushCodexRestart(ownerId: string, deviceId: string) {
    await this.pushCommand(ownerId, deviceId, { type: 'restart-codex' });
  }

  private async pushCommand(ownerId: string, deviceId: string, command: RemoteCommand) {
    const socket = this.sockets.get(this.socketKey(ownerId, deviceId));
    const session = socket ? this.sessions.get(socket) : undefined;
    if (
      !socket
      || socket.readyState !== WebSocket.OPEN
      || session?.kind !== 'device'
      || session.ownerId !== ownerId
    ) {
      throw new Error('Device is offline');
    }

    const commandId = randomUUID();
    const completion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error('Timed out while waiting for the device command'));
      }, 25_000);
      this.pending.set(commandId, { ownerId, deviceId, resolve, reject, timer });
    });
    socket.send(JSON.stringify({ ...command, commandId }));
    await completion;
  }

  private async handleMessage(client: WebSocket, raw: RawData) {
    const message = JSON.parse(raw.toString()) as
      AuthMessage | SubscribeDevicesMessage | SwitchResultMessage;
    if (!this.sessions.has(client)) {
      if (message.type === 'authenticate') {
        await this.authenticateDevice(client, message);
        return;
      }
      if (message.type === 'subscribe-devices') {
        await this.authenticateDeviceSubscriber(client, message);
        return;
      }
      throw new Error('Authentication required');
    }
    const session = this.sessions.get(client);
    if (session?.kind !== 'device') {
      return;
    }
    if (message.type === 'switch-result') {
      const pending = this.pending.get(message.commandId);
      if (
        !pending
        || pending.ownerId !== session.ownerId
        || pending.deviceId !== session.deviceId
      ) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.commandId);
      if (message.success) pending.resolve();
      else pending.reject(new Error(message.error || 'The device command failed'));
      await this.devices.touch(session.deviceId);
    }
  }

  private async authenticateDevice(client: WebSocket, message: AuthMessage) {
    const ownerId = await this.authenticateUser(message.accessToken);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(message.deviceId)) {
      throw new Error('Device id is invalid');
    }

    const key = this.socketKey(ownerId, message.deviceId);
    const previous = this.sockets.get(key);
    const device = await this.devices.register(ownerId, {
      deviceId: message.deviceId,
      name: message.name,
      platform: message.platform,
      appVersion: message.appVersion,
      activeAccountId: message.activeAccountId,
      openaiAuthAccountId: message.openaiAuthAccountId,
      activeProviderId: message.activeProviderId,
      localProxyRunning: message.localProxyRunning,
      capabilities: normalizeCapabilities(message.capabilities),
    });
    const authTimer = this.authTimers.get(client);
    if (authTimer) clearTimeout(authTimer);
    this.authTimers.delete(client);
    this.sessions.set(client, { kind: 'device', ownerId, deviceId: message.deviceId });
    this.sockets.set(key, client);
    if (previous && previous !== client) previous.close(4000, 'Replaced by a newer connection');
    client.send(JSON.stringify({ type: 'authenticated', deviceId: message.deviceId }));
    this.broadcastToDeviceSubscribers(ownerId, {
      type: 'device-online',
      device: this.deviceStatus(device ?? message, true),
    });
  }

  private async authenticateDeviceSubscriber(
    client: WebSocket,
    message: SubscribeDevicesMessage,
  ) {
    const ownerId = await this.authenticateUser(message.accessToken);
    const authTimer = this.authTimers.get(client);
    if (authTimer) clearTimeout(authTimer);
    this.authTimers.delete(client);
    this.sessions.set(client, { kind: 'device-subscriber', ownerId });
    const subscribers = this.deviceSubscribers.get(ownerId) ?? new Set<WebSocket>();
    subscribers.add(client);
    this.deviceSubscribers.set(ownerId, subscribers);

    const devices = await this.devices.list(ownerId);
    client.send(JSON.stringify({
      type: 'devices-snapshot',
      devices: devices.map((device) => this.deviceStatus(
        device,
        this.isOnline(ownerId, device.deviceId),
      )),
    }));
  }

  private async authenticateUser(accessToken: string) {
    const payload = await this.jwt.verifyAsync<AccessPayload>(accessToken, {
      secret: getKongJwtSecret(this.config),
    });
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new Error('User is disabled or no longer exists');
    return user.id;
  }

  private deviceStatus(
    device: {
      deviceId: string;
      name: string;
      platform: string;
      appVersion?: string | null;
      activeAccountId?: string | null;
      openaiAuthAccountId?: string | null;
      activeProviderId?: string | null;
      localProxyRunning?: boolean;
      capabilities?: string[];
      lastSeenAt?: Date | string;
    },
    online: boolean,
  ): RemoteDeviceStatus {
    const lastSeenAt = device.lastSeenAt
      ? new Date(device.lastSeenAt).toISOString()
      : new Date().toISOString();
    return {
      deviceId: device.deviceId,
      name: device.name,
      platform: device.platform,
      appVersion: device.appVersion,
      activeAccountId: device.activeAccountId,
      openaiAuthAccountId: device.openaiAuthAccountId,
      activeProviderId: device.activeProviderId,
      localProxyRunning: device.localProxyRunning ?? false,
      capabilities: normalizeCapabilities(device.capabilities),
      lastSeenAt,
      online,
    };
  }

  private broadcastToDeviceSubscribers(ownerId: string, message: object) {
    const payload = JSON.stringify(message);
    for (const subscriber of this.deviceSubscribers.get(ownerId) ?? []) {
      if (subscriber.readyState !== WebSocket.OPEN) continue;
      try {
        subscriber.send(payload);
      } catch {
        subscriber.terminate();
      }
    }
  }

  private socketKey(ownerId: string, deviceId: string) {
    return `${ownerId}:${deviceId}`;
  }
}

const REMOTE_CONTROL_CAPABILITIES = new Set(['provider-switch', 'restart-codex']);

function normalizeCapabilities(value: string[] | undefined) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((capability) => REMOTE_CONTROL_CAPABILITIES.has(capability)))];
}
