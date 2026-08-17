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

const DEVICE_ID = '10000000-0000-4000-8000-000000000001';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function createGatewayHarness(deviceOverrides: Record<string, unknown> = {}) {
  const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1' }) };
  const users = {
    findActiveById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
  };
  const devices = {
    list: vi.fn().mockResolvedValue([]),
    register: vi.fn().mockResolvedValue(undefined),
    touch: vi.fn().mockResolvedValue(undefined),
    ...deviceOverrides,
  };
  const gateway = new DeviceGateway(
    jwt as unknown as JwtService,
    users as unknown as UserService,
    devices as unknown as DeviceControlService,
    { KONG_JWT_SECRET: 'test-secret' } as ConfigModuleOptions,
  );
  return { gateway, devices };
}

async function authenticateDesktop(gateway: DeviceGateway, socket: FakeWebSocket) {
  gateway.handleConnection(socket as unknown as WebSocket);
  socket.emit('message', Buffer.from(JSON.stringify({
    type: 'authenticate',
    accessToken: 'access-token',
    deviceId: DEVICE_ID,
    name: 'Work PC',
    platform: 'windows',
    appVersion: '1.2.3',
    activeAccountId: 'account-1',
    openaiAuthAccountId: 'account-3',
    activeProviderId: 'provider-1',
    localProxyRunning: true,
    capabilities: ['provider-switch', 'restart-codex', 'unknown-capability'],
  })));
  await tick();
}

function acknowledge(socket: FakeWebSocket, commandId: string) {
  socket.emit('message', Buffer.from(JSON.stringify({
    type: 'switch-result',
    commandId,
    success: true,
  })));
}

describe('DeviceGateway', () => {
  it('registers the desktop model routing state and supported capabilities', async () => {
    const { gateway, devices } = createGatewayHarness();
    const socket = new FakeWebSocket();
    await authenticateDesktop(gateway, socket);

    expect(gateway.isOnline('user-1', DEVICE_ID)).toBe(true);
    expect(devices.register).toHaveBeenCalledWith('user-1', expect.objectContaining({
      deviceId: DEVICE_ID,
      activeAccountId: 'account-1',
      openaiAuthAccountId: 'account-3',
      activeProviderId: 'provider-1',
      localProxyRunning: true,
      capabilities: ['provider-switch', 'restart-codex'],
    }));
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'authenticated', deviceId: DEVICE_ID });
    gateway.handleDisconnect(socket as unknown as WebSocket);
  });

  it('resolves official account commands after the desktop acknowledges them', async () => {
    const { gateway, devices } = createGatewayHarness();
    const socket = new FakeWebSocket();
    await authenticateDesktop(gateway, socket);

    const accountCompletion = gateway.pushAccountSwitch('user-1', DEVICE_ID, 'account-2');
    const accountCommand = JSON.parse(socket.sent[1]) as { commandId: string };
    expect(accountCommand).toMatchObject({ type: 'switch-account', accountId: 'account-2' });
    acknowledge(socket, accountCommand.commandId);
    await expect(accountCompletion).resolves.toBeUndefined();

    const authCompletion = gateway.pushOpenAiAuthAccountSwitch('user-1', DEVICE_ID, 'account-3');
    const authCommand = JSON.parse(socket.sent[2]) as { commandId: string };
    expect(authCommand).toMatchObject({
      type: 'set-openai-auth-account',
      accountId: 'account-3',
    });
    acknowledge(socket, authCommand.commandId);
    await expect(authCompletion).resolves.toBeUndefined();
    await tick();
    expect(devices.touch).toHaveBeenCalledWith(DEVICE_ID);
    gateway.handleDisconnect(socket as unknown as WebSocket);
  });

  it('pushes provider switching and Codex restart commands to the target desktop', async () => {
    const { gateway } = createGatewayHarness();
    const socket = new FakeWebSocket();
    await authenticateDesktop(gateway, socket);

    const providerCompletion = gateway.pushProviderSwitch('user-1', DEVICE_ID, 'provider-2');
    const providerCommand = JSON.parse(socket.sent[1]) as { commandId: string };
    expect(providerCommand).toMatchObject({
      type: 'switch-provider',
      providerId: 'provider-2',
    });
    acknowledge(socket, providerCommand.commandId);
    await expect(providerCompletion).resolves.toBeUndefined();

    const restartCompletion = gateway.pushCodexRestart('user-1', DEVICE_ID);
    const restartCommand = JSON.parse(socket.sent[2]) as { commandId: string };
    expect(restartCommand).toMatchObject({ type: 'restart-codex' });
    acknowledge(socket, restartCommand.commandId);
    await expect(restartCompletion).resolves.toBeUndefined();
    gateway.handleDisconnect(socket as unknown as WebSocket);
  });

  it('pushes model routing state in desktop login and disconnect events', async () => {
    const registeredDevice = {
      deviceId: DEVICE_ID,
      name: 'Work PC',
      platform: 'windows',
      appVersion: '1.2.3',
      activeAccountId: 'account-1',
      openaiAuthAccountId: 'account-2',
      activeProviderId: 'provider-1',
      localProxyRunning: true,
      capabilities: ['provider-switch', 'restart-codex'],
      lastSeenAt: new Date('2026-07-26T01:00:00.000Z'),
    };
    const { gateway, devices } = createGatewayHarness({
      register: vi.fn().mockResolvedValue(registeredDevice),
    });
    const subscriber = new FakeWebSocket();
    gateway.handleConnection(subscriber as unknown as WebSocket);
    subscriber.emit('message', Buffer.from(JSON.stringify({
      type: 'subscribe-devices',
      accessToken: 'mobile-access-token',
    })));
    await tick();
    expect(JSON.parse(subscriber.sent[0])).toEqual({ type: 'devices-snapshot', devices: [] });

    const desktop = new FakeWebSocket();
    await authenticateDesktop(gateway, desktop);
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
    expect(offline).toMatchObject({ type: 'device-offline', deviceId: DEVICE_ID });
    expect(new Date(offline.lastSeenAt).toString()).not.toBe('Invalid Date');
    expect(devices.touch).toHaveBeenCalledWith(DEVICE_ID);
    gateway.handleDisconnect(subscriber as unknown as WebSocket);
  });
});
