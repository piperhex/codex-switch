import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigModuleOptions } from '@/config/config.types';
import type { UserService } from '@/modules/user/user.service';
import type { DeviceControlService } from '@/modules/devices/device-control.service';
import { DeviceGateway } from '@/modules/devices/device.gateway';

class FakeWebSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('DeviceGateway', () => {
  it('authenticates a desktop and resolves a targeted switch after its acknowledgement', async () => {
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1' }) };
    const users = {
      findActiveById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
    };
    const devices = {
      register: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = new DeviceGateway(
      jwt as unknown as JwtService,
      users as unknown as UserService,
      devices as unknown as DeviceControlService,
      { KONG_JWT_SECRET: 'test-secret' } as ConfigModuleOptions,
    );
    const socket = new FakeWebSocket();
    const deviceId = '10000000-0000-4000-8000-000000000001';
    gateway.handleConnection(socket as unknown as WebSocket);
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'authenticate',
      accessToken: 'access-token',
      deviceId,
      name: 'Work PC',
      platform: 'windows',
      appVersion: '1.2.3',
      activeAccountId: 'account-1',
      openaiAuthAccountId: 'account-3',
    })));
    await tick();

    expect(gateway.isOnline('user-1', deviceId)).toBe(true);
    expect(devices.register).toHaveBeenCalledWith('user-1', expect.objectContaining({
      deviceId,
      activeAccountId: 'account-1',
      openaiAuthAccountId: 'account-3',
    }));
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'authenticated', deviceId });

    const switchCompletion = gateway.pushAccountSwitch('user-1', deviceId, 'account-2');
    const command = JSON.parse(socket.sent[1]) as {
      type: string;
      commandId: string;
      accountId: string;
    };
    expect(command).toMatchObject({ type: 'switch-account', accountId: 'account-2' });
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'switch-result',
      commandId: command.commandId,
      success: true,
    })));

    await expect(switchCompletion).resolves.toBeUndefined();
    await tick();
    expect(devices.touch).toHaveBeenCalledWith(deviceId);

    const loginSwitchCompletion = gateway.pushOpenAiAuthAccountSwitch(
      'user-1',
      deviceId,
      'account-3',
    );
    const loginCommand = JSON.parse(socket.sent[2]) as {
      type: string;
      commandId: string;
      accountId: string;
    };
    expect(loginCommand).toMatchObject({
      type: 'set-openai-auth-account',
      accountId: 'account-3',
    });
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'switch-result',
      commandId: loginCommand.commandId,
      success: true,
    })));
    await expect(loginSwitchCompletion).resolves.toBeUndefined();
    gateway.handleDisconnect(socket as unknown as WebSocket);
  });

  it('pushes owned device login and disconnect events to authenticated subscribers', async () => {
    const deviceId = '10000000-0000-4000-8000-000000000001';
    const registeredDevice = {
      deviceId,
      name: 'Work PC',
      platform: 'windows',
      appVersion: '1.2.3',
      activeAccountId: 'account-1',
      openaiAuthAccountId: 'account-2',
      lastSeenAt: new Date('2026-07-26T01:00:00.000Z'),
    };
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1' }) };
    const users = {
      findActiveById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
    };
    const devices = {
      list: vi.fn().mockResolvedValue([]),
      register: vi.fn().mockResolvedValue(registeredDevice),
      touch: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = new DeviceGateway(
      jwt as unknown as JwtService,
      users as unknown as UserService,
      devices as unknown as DeviceControlService,
      { KONG_JWT_SECRET: 'test-secret' } as ConfigModuleOptions,
    );
    const subscriber = new FakeWebSocket();
    gateway.handleConnection(subscriber as unknown as WebSocket);
    subscriber.emit('message', Buffer.from(JSON.stringify({
      type: 'subscribe-devices',
      accessToken: 'mobile-access-token',
    })));
    await tick();

    expect(JSON.parse(subscriber.sent[0])).toEqual({
      type: 'devices-snapshot',
      devices: [],
    });

    const desktop = new FakeWebSocket();
    gateway.handleConnection(desktop as unknown as WebSocket);
    desktop.emit('message', Buffer.from(JSON.stringify({
      type: 'authenticate',
      accessToken: 'desktop-access-token',
      deviceId,
      name: registeredDevice.name,
      platform: registeredDevice.platform,
      appVersion: registeredDevice.appVersion,
      activeAccountId: registeredDevice.activeAccountId,
      openaiAuthAccountId: registeredDevice.openaiAuthAccountId,
    })));
    await tick();

    expect(JSON.parse(subscriber.sent[1])).toEqual({
      type: 'device-online',
      device: {
        ...registeredDevice,
        lastSeenAt: registeredDevice.lastSeenAt.toISOString(),
        online: true,
      },
    });

    gateway.handleDisconnect(desktop as unknown as WebSocket);
    const offline = JSON.parse(subscriber.sent[2]) as {
      type: string;
      deviceId: string;
      lastSeenAt: string;
    };
    expect(offline).toMatchObject({ type: 'device-offline', deviceId });
    expect(new Date(offline.lastSeenAt).toString()).not.toBe('Invalid Date');
    expect(devices.touch).toHaveBeenCalledWith(deviceId);
    gateway.handleDisconnect(subscriber as unknown as WebSocket);
  });
});
