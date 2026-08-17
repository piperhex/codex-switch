import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { DeviceController } from '@/modules/devices/device.controller';
import type { DeviceControlService } from '@/modules/devices/device-control.service';
import type { DeviceGateway } from '@/modules/devices/device.gateway';

describe('DeviceController', () => {
  const user: AuthUser = { id: 'user-1', email: 'user@example.com', role: 'user' };

  it('reports model routing and online state for each owned desktop device', async () => {
    const devices = {
      list: vi.fn().mockResolvedValue([{
        deviceId: 'device-1',
        name: 'Work PC',
        platform: 'windows',
        appVersion: '1.2.3',
        activeAccountId: 'account-1',
        openaiAuthAccountId: 'account-2',
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
        openaiAuthAccountId: 'account-2',
        activeProviderId: null,
        localProxyRunning: false,
        capabilities: [],
        online: true,
      })],
    });
    expect(gateway.isOnline).toHaveBeenCalledWith(user.id, 'device-1');
  });

  it('returns safe provider summaries without credentials', async () => {
    const providers = [{ id: 'provider-1', name: 'Gateway', model: 'model-a' }];
    const devices = { listProviderSummaries: vi.fn().mockResolvedValue(providers) };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      {} as DeviceGateway,
    );

    await expect(controller.listProviders(user)).resolves.toEqual({ providers });
    expect(devices.listProviderSummaries).toHaveBeenCalledWith(user.id);
  });

  it('switches between official accounts without requiring a restart', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-1',
        activeProviderId: null,
      }),
      assertAccountAvailable: vi.fn().mockResolvedValue(undefined),
      setActiveAccount: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-2',
        activeProviderId: null,
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
      activeProviderId: null,
      requiresRestart: false,
      online: true,
    });
    expect(devices.assertAccountAvailable).toHaveBeenCalledWith(user.id, 'account-2');
    expect(gateway.pushAccountSwitch).toHaveBeenCalledWith(user.id, 'device-1', 'account-2');
  });

  it('requires a restart when switching from a provider to an official account', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-1',
        activeProviderId: 'provider-1',
      }),
      assertAccountAvailable: vi.fn().mockResolvedValue(undefined),
      setActiveAccount: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-2',
        activeProviderId: null,
      }),
    };
    const gateway = { pushAccountSwitch: vi.fn().mockResolvedValue(undefined) };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    const result = await controller.switchAccount(user, 'device-1', { accountId: 'account-2' });
    expect(result.requiresRestart).toBe(true);
  });

  it('switches from an official account to a provider and requires a restart', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-1',
        activeProviderId: null,
        localProxyRunning: true,
        capabilities: ['provider-switch'],
      }),
      assertProviderAvailable: vi.fn().mockResolvedValue(undefined),
      setActiveProvider: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-1',
        activeProviderId: 'provider-1',
      }),
    };
    const gateway = { pushProviderSwitch: vi.fn().mockResolvedValue(undefined) };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.switchProvider(
      user,
      'device-1',
      { providerId: 'provider-1' },
    )).resolves.toEqual({
      deviceId: 'device-1',
      activeAccountId: 'account-1',
      activeProviderId: 'provider-1',
      requiresRestart: true,
      online: true,
    });
    expect(devices.assertProviderAvailable).toHaveBeenCalledWith(user.id, 'provider-1');
    expect(gateway.pushProviderSwitch).toHaveBeenCalledWith(user.id, 'device-1', 'provider-1');
  });

  it('does not require a restart when switching between providers', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-1',
        activeProviderId: 'provider-1',
        localProxyRunning: true,
        capabilities: ['provider-switch'],
      }),
      assertProviderAvailable: vi.fn().mockResolvedValue(undefined),
      setActiveProvider: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        activeAccountId: 'account-1',
        activeProviderId: 'provider-2',
      }),
    };
    const gateway = { pushProviderSwitch: vi.fn().mockResolvedValue(undefined) };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    const result = await controller.switchProvider(user, 'device-1', { providerId: 'provider-2' });
    expect(result.requiresRestart).toBe(false);
  });

  it('rejects provider switching when the desktop capability is unavailable', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        localProxyRunning: true,
      }),
      assertProviderAvailable: vi.fn(),
    };
    const gateway = { pushProviderSwitch: vi.fn() };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.switchProvider(
      user,
      'device-1',
      { providerId: 'provider-1' },
    )).rejects.toThrow('请先更新目标 PC 上的 Codex Switch');
    expect(devices.assertProviderAvailable).not.toHaveBeenCalled();
    expect(gateway.pushProviderSwitch).not.toHaveBeenCalled();
  });

  it('rejects provider switching while the desktop local proxy is stopped', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        localProxyRunning: false,
        capabilities: ['provider-switch'],
      }),
      assertProviderAvailable: vi.fn(),
    };
    const gateway = { pushProviderSwitch: vi.fn() };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.switchProvider(
      user,
      'device-1',
      { providerId: 'provider-1' },
    )).rejects.toThrow('请先在目标 PC 上启动本地代理');
    expect(devices.assertProviderAvailable).not.toHaveBeenCalled();
    expect(gateway.pushProviderSwitch).not.toHaveBeenCalled();
  });

  it('restarts Codex on a capable online desktop', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        capabilities: ['restart-codex'],
      }),
    };
    const gateway = { pushCodexRestart: vi.fn().mockResolvedValue(undefined) };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.restartCodex(user, 'device-1')).resolves.toEqual({
      deviceId: 'device-1',
      restarted: true,
      online: true,
    });
    expect(gateway.pushCodexRestart).toHaveBeenCalledWith(user.id, 'device-1');
  });

  it('pushes a proxy login account switch and persists the acknowledged account', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({ deviceId: 'device-1' }),
      assertAccountAvailable: vi.fn().mockResolvedValue(undefined),
      setOpenAiAuthAccount: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        openaiAuthAccountId: 'account-2',
      }),
    };
    const gateway = {
      pushOpenAiAuthAccountSwitch: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.setOpenAiAuthAccount(
      user,
      'device-1',
      { accountId: 'account-2' },
    )).resolves.toEqual({
      deviceId: 'device-1',
      openaiAuthAccountId: 'account-2',
      online: true,
    });
    expect(devices.assertAccountAvailable).toHaveBeenCalledWith(user.id, 'account-2');
    expect(gateway.pushOpenAiAuthAccountSwitch)
      .toHaveBeenCalledWith(user.id, 'device-1', 'account-2');
    expect(devices.setOpenAiAuthAccount)
      .toHaveBeenCalledWith(user.id, 'device-1', 'account-2');
  });

  it('removes an owned offline device and notifies live device subscribers', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({ deviceId: 'device-1' }),
      removeOwned: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = {
      isOnline: vi.fn().mockReturnValue(false),
      notifyDeviceRemoved: vi.fn(),
    };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.remove(user, 'device-1')).resolves.toBeUndefined();
    expect(devices.removeOwned).toHaveBeenCalledWith(user.id, 'device-1');
    expect(gateway.notifyDeviceRemoved).toHaveBeenCalledWith(user.id, 'device-1');
  });

  it('does not remove a device while it is online', async () => {
    const devices = {
      getOwned: vi.fn().mockResolvedValue({ deviceId: 'device-1' }),
      removeOwned: vi.fn(),
    };
    const gateway = {
      isOnline: vi.fn().mockReturnValue(true),
      notifyDeviceRemoved: vi.fn(),
    };
    const controller = new DeviceController(
      devices as unknown as DeviceControlService,
      gateway as unknown as DeviceGateway,
    );

    await expect(controller.remove(user, 'device-1')).rejects.toThrow(
      'Online devices cannot be removed',
    );
    expect(devices.removeOwned).not.toHaveBeenCalled();
    expect(gateway.notifyDeviceRemoved).not.toHaveBeenCalled();
  });
});
