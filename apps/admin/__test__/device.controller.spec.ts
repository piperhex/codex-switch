import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { DeviceController } from '@/modules/devices/device.controller';
import type { DeviceControlService } from '@/modules/devices/device-control.service';
import type { DeviceGateway } from '@/modules/devices/device.gateway';

describe('DeviceController', () => {
  const user: AuthUser = { id: 'user-1', email: 'user@example.com', role: 'user' };

  it('reports online state per owned desktop device', async () => {
    const devices = {
      list: vi.fn().mockResolvedValue([{
        deviceId: 'device-1',
        name: 'Work PC',
        platform: 'windows',
        appVersion: '1.2.3',
        activeAccountId: 'account-1',
        lastSeenAt: new Date('2026-07-23T01:00:00.000Z'),
      }]),
    };
    const gateway = { isOnline: vi.fn().mockReturnValue(true) };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.list(user)).resolves.toEqual({
      devices: [expect.objectContaining({
        deviceId: 'device-1',
        activeAccountId: 'account-1',
        online: true,
      })],
    });
    expect(gateway.isOnline).toHaveBeenCalledWith(user.id, 'device-1');
  });

  it('pushes a switch only after checking device ownership and account access', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({ deviceId: 'device-1' }),
      assertAccountAvailable: vi.fn().mockResolvedValue(undefined),
      setActiveAccount: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-2',
      }),
    };
    const gateway = { pushAccountSwitch: vi.fn().mockResolvedValue(undefined) };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.switchAccount(
      user,
      'device-1',
      { accountId: 'account-2' },
    )).resolves.toEqual({
      deviceId: 'device-1',
      activeAccountId: 'account-2',
      online: true,
    });
    expect(devices.getOwned).toHaveBeenCalledWith(user.id, 'device-1');
    expect(devices.assertAccountAvailable).toHaveBeenCalledWith(user.id, 'account-2');
    expect(gateway.pushAccountSwitch).toHaveBeenCalledWith(user.id, 'device-1', 'account-2');
  });
});
