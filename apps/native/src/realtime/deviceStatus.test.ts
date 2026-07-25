import { describe, expect, it } from 'vitest';
import type { AuthSession, RemoteDevice } from '../types';
import {
  applyDeviceStatusSocketMessage,
  deviceStatusSubscriptionMessage,
  deviceStatusWebSocketUrl,
  parseDeviceStatusSocketMessage,
} from './deviceStatus';

const device: RemoteDevice = {
  deviceId: 'device-1',
  name: 'Work PC',
  platform: 'windows',
  appVersion: '1.2.3',
  activeAccountId: 'account-1',
  lastSeenAt: '2026-07-26T01:00:00.000Z',
  online: true,
};

describe('mobile device status WebSocket protocol', () => {
  it('builds the WebSocket URL and subscription login message', () => {
    const session: AuthSession = {
      baseUrl: 'https://switch.example.com/api/',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      email: 'user@example.com',
    };

    expect(deviceStatusWebSocketUrl(session.baseUrl))
      .toBe('wss://switch.example.com/api/device-switch');
    expect(JSON.parse(deviceStatusSubscriptionMessage(session))).toEqual({
      type: 'subscribe-devices',
      accessToken: 'access-token',
    });
  });

  it('adds an online device and applies its later offline event', () => {
    const onlineMessage = parseDeviceStatusSocketMessage(JSON.stringify({
      type: 'device-online',
      device,
    }));
    expect(onlineMessage).not.toBeNull();
    const online = applyDeviceStatusSocketMessage([], onlineMessage!);
    expect(online).toEqual([device]);

    const offlineMessage = parseDeviceStatusSocketMessage(JSON.stringify({
      type: 'device-offline',
      deviceId: device.deviceId,
      lastSeenAt: '2026-07-26T02:00:00.000Z',
    }));
    expect(offlineMessage).not.toBeNull();
    expect(applyDeviceStatusSocketMessage(online, offlineMessage!)).toEqual([{
      ...device,
      online: false,
      lastSeenAt: '2026-07-26T02:00:00.000Z',
    }]);
  });

  it('refreshes known devices from a reconnect snapshot', () => {
    const snapshot = parseDeviceStatusSocketMessage(JSON.stringify({
      type: 'devices-snapshot',
      devices: [{ ...device, online: false }],
    }));

    expect(snapshot).not.toBeNull();
    expect(applyDeviceStatusSocketMessage([{ ...device, name: 'Stale name' }], snapshot!))
      .toEqual([{ ...device, online: false }]);
  });

  it('keeps a just-pushed new device if it raced with the initial snapshot query', () => {
    const snapshot = parseDeviceStatusSocketMessage(JSON.stringify({
      type: 'devices-snapshot',
      devices: [],
    }));

    expect(snapshot).not.toBeNull();
    expect(applyDeviceStatusSocketMessage([device], snapshot!)).toEqual([device]);
  });
});
