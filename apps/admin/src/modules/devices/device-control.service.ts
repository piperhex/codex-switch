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

  async assertAccountAvailable(ownerId: string, accountId: string) {
    const { accounts } = await this.sync.listSummary(ownerId);
    if (!accounts.some((account) => account.id === accountId)) {
      throw new NotFoundException('Account was not found');
    }
  }

  async setActiveAccount(ownerId: string, deviceId: string, accountId: string) {
    await this.devices.update(
      { ownerId, deviceId },
      { activeAccountId: accountId, lastSeenAt: new Date() },
    );
    return this.getOwned(ownerId, deviceId);
  }
}
