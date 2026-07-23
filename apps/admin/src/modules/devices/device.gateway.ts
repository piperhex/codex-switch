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
}

interface SwitchResultMessage {
  type: 'switch-result';
  commandId: string;
  success: boolean;
  error?: string;
}

interface ClientSession {
  ownerId: string;
  deviceId: string;
}

interface PendingSwitch {
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
  private readonly pending = new Map<string, PendingSwitch>();
  private readonly authTimers = new Map<WebSocket, NodeJS.Timeout>();

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UserService,
    private readonly devices: DeviceControlService,
    @Inject(MODULE_OPTIONS_TOKEN) private readonly config: ConfigModuleOptions,
  ) {}

  handleConnection(client: WebSocket) {
    const authTimer = setTimeout(() => client.close(4001, 'Authentication timed out'), 10_000);
    this.authTimers.set(client, authTimer);
    client.on('message', (raw) => {
      void this.handleMessage(client, raw).catch(() => client.close(4001, 'Invalid message'));
    });
    client.once('close', () => clearTimeout(authTimer));
  }

  handleDisconnect(client: WebSocket) {
    const session = this.sessions.get(client);
    const authTimer = this.authTimers.get(client);
    if (authTimer) clearTimeout(authTimer);
    this.authTimers.delete(client);
    this.sessions.delete(client);
    if (session && this.sockets.get(this.socketKey(session.ownerId, session.deviceId)) === client) {
      this.sockets.delete(this.socketKey(session.ownerId, session.deviceId));
    }
    for (const [commandId, pending] of this.pending) {
      if (pending.ownerId !== session?.ownerId || pending.deviceId !== session.deviceId) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error('Device disconnected before the account was switched'));
      this.pending.delete(commandId);
    }
  }

  isOnline(ownerId: string, deviceId: string) {
    const socket = this.sockets.get(this.socketKey(ownerId, deviceId));
    const session = socket ? this.sessions.get(socket) : undefined;
    return socket?.readyState === WebSocket.OPEN && session?.ownerId === ownerId;
  }

  async pushAccountSwitch(ownerId: string, deviceId: string, accountId: string) {
    const socket = this.sockets.get(this.socketKey(ownerId, deviceId));
    const session = socket ? this.sessions.get(socket) : undefined;
    if (!socket || socket.readyState !== WebSocket.OPEN || session?.ownerId !== ownerId) {
      throw new Error('Device is offline');
    }

    const commandId = randomUUID();
    const completion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error('Timed out while waiting for the device to switch accounts'));
      }, 25_000);
      this.pending.set(commandId, { ownerId, deviceId, resolve, reject, timer });
    });
    socket.send(JSON.stringify({ type: 'switch-account', commandId, accountId }));
    await completion;
  }

  private async handleMessage(client: WebSocket, raw: RawData) {
    const message = JSON.parse(raw.toString()) as AuthMessage | SwitchResultMessage;
    if (!this.sessions.has(client)) {
      if (message.type !== 'authenticate') throw new Error('Authentication required');
      await this.authenticate(client, message);
      return;
    }
    if (message.type === 'switch-result') {
      const pending = this.pending.get(message.commandId);
      const session = this.sessions.get(client);
      if (
        !pending
        || pending.ownerId !== session?.ownerId
        || pending.deviceId !== session.deviceId
      ) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.commandId);
      if (message.success) pending.resolve();
      else pending.reject(new Error(message.error || 'The device could not switch accounts'));
      await this.devices.touch(session.deviceId);
    }
  }

  private async authenticate(client: WebSocket, message: AuthMessage) {
    const payload = await this.jwt.verifyAsync<AccessPayload>(message.accessToken, {
      secret: getKongJwtSecret(this.config),
    });
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new Error('User is disabled or no longer exists');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(message.deviceId)) {
      throw new Error('Device id is invalid');
    }

    const key = this.socketKey(user.id, message.deviceId);
    const previous = this.sockets.get(key);
    if (previous && previous !== client) previous.close(4000, 'Replaced by a newer connection');
    await this.devices.register(user.id, {
      deviceId: message.deviceId,
      name: message.name,
      platform: message.platform,
      appVersion: message.appVersion,
      activeAccountId: message.activeAccountId,
    });
    const authTimer = this.authTimers.get(client);
    if (authTimer) clearTimeout(authTimer);
    this.authTimers.delete(client);
    this.sessions.set(client, { ownerId: user.id, deviceId: message.deviceId });
    this.sockets.set(key, client);
    client.send(JSON.stringify({ type: 'authenticated', deviceId: message.deviceId }));
  }

  private socketKey(ownerId: string, deviceId: string) {
    return `${ownerId}:${deviceId}`;
  }
}
