import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncService } from '@/modules/sync/sync.service';
import { RemoteDeviceEntity } from './entities/remote-device.entity';

export interface RegisterRemoteDevice {
  deviceId: string;
  name: string;
  platform: string;
  appVersion?: string | null;
  activeAccountId?: string | null;
  openaiAuthAccountId?: string | null;
  activeProviderId?: string | null;
  activeProviderGroup?: string | null;
  localProxyRunning?: boolean;
  capabilities?: string[];
}

export interface RemoteProviderSummary {
  id: string;
  name: string;
  model: string;
  group: string;
}

@Injectable()
export class DeviceControlService {
  constructor(
    @InjectRepository(RemoteDeviceEntity)
    private readonly devices: Repository<RemoteDeviceEntity>,
    private readonly sync: SyncService,
  ) {}

  async register(ownerId: string, input: RegisterRemoteDevice) {
    const existing = await this.devices.findOne({
      where: { ownerId, deviceId: input.deviceId },
    });
    const device = this.devices.create({
      ...existing,
      deviceId: input.deviceId,
      ownerId,
      name: input.name.trim().slice(0, 120) || 'Codex Switch',
      platform: input.platform.trim().slice(0, 20) || 'unknown',
      appVersion: input.appVersion?.trim().slice(0, 50) || null,
      activeAccountId: input.activeAccountId ?? existing?.activeAccountId ?? null,
      openaiAuthAccountId: input.openaiAuthAccountId ?? existing?.openaiAuthAccountId ?? null,
      activeProviderId: input.activeProviderId === undefined
        ? existing?.activeProviderId ?? null
        : input.activeProviderId,
      activeProviderGroup: input.activeProviderGroup === undefined
        ? existing?.activeProviderGroup ?? null
        : input.activeProviderGroup,
      localProxyRunning: input.localProxyRunning ?? existing?.localProxyRunning ?? false,
      capabilities: input.capabilities ?? existing?.capabilities ?? [],
      lastSeenAt: new Date(),
    });
    return this.devices.save(device);
  }

  async touch(deviceId: string) {
    await this.devices.update({ deviceId }, { lastSeenAt: new Date() });
  }

  async list(ownerId: string) {
    return this.devices.find({
      where: { ownerId },
      order: { lastSeenAt: 'DESC', name: 'ASC' },
    });
  }

  async getOwned(ownerId: string, deviceId: string) {
    const device = await this.devices.findOne({ where: { ownerId, deviceId } });
    if (!device) throw new NotFoundException('Device was not found');
    return device;
  }

  async removeOwned(ownerId: string, deviceId: string) {
    const result = await this.devices.delete({ ownerId, deviceId });
    if (result.affected !== 1) throw new NotFoundException('Device was not found');
  }

  async assertAccountAvailable(ownerId: string, accountId: string) {
    const { accounts } = await this.sync.listSummary(ownerId);
    if (!accounts.some((account) => account.id === accountId)) {
      throw new NotFoundException('Account was not found');
    }
  }

  async listProviderSummaries(ownerId: string): Promise<RemoteProviderSummary[]> {
    const { providers } = await this.sync.listProviders(ownerId);
    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      model: provider.model,
      group: provider.group ?? '',
    }));
  }

  async assertProviderAvailable(ownerId: string, providerId: string) {
    const providers = await this.listProviderSummaries(ownerId);
    if (!providers.some((provider) => provider.id === providerId)) {
      throw new NotFoundException('Provider was not found');
    }
  }

  async assertProviderGroupAvailable(ownerId: string, group: string) {
    const providers = await this.listProviderSummaries(ownerId);
    if (!group.trim() || !providers.some((provider) => provider.group === group)) {
      throw new NotFoundException('Provider group was not found');
    }
  }

  async setActiveAccount(ownerId: string, deviceId: string, accountId: string) {
    await this.devices.update(
      { ownerId, deviceId },
      {
        activeAccountId: accountId,
        activeProviderId: null,
        activeProviderGroup: null,
        lastSeenAt: new Date(),
      },
    );
    return this.getOwned(ownerId, deviceId);
  }

  async setActiveProvider(ownerId: string, deviceId: string, providerId: string) {
    await this.devices.update(
      { ownerId, deviceId },
      { activeProviderId: providerId, activeProviderGroup: null, lastSeenAt: new Date() },
    );
    return this.getOwned(ownerId, deviceId);
  }

  async setActiveProviderGroup(ownerId: string, deviceId: string, group: string) {
    await this.devices.update(
      { ownerId, deviceId },
      { activeProviderId: null, activeProviderGroup: group, lastSeenAt: new Date() },
    );
    return this.getOwned(ownerId, deviceId);
  }

  async setOpenAiAuthAccount(ownerId: string, deviceId: string, accountId: string) {
    await this.devices.update(
      { ownerId, deviceId },
      { openaiAuthAccountId: accountId, lastSeenAt: new Date() },
    );
    return this.getOwned(ownerId, deviceId);
  }
}
