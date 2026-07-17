import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreateInstallationEventDto } from './dto/create-installation-event.dto';
import { DeviceInstallationEntity } from './entities/device-installation.entity';
import { DeviceTelemetryEventEntity } from './entities/device-telemetry-event.entity';

@Injectable()
export class TelemetryService {
  constructor(
    @InjectRepository(DeviceInstallationEntity)
    private readonly installations: Repository<DeviceInstallationEntity>,
    @InjectRepository(DeviceTelemetryEventEntity)
    private readonly events: Repository<DeviceTelemetryEventEntity>,
  ) {}

  async recordInstallation(dto: CreateInstallationEventDto) {
    await this.installations.upsert({
      deviceId: dto.deviceId,
      platform: dto.platform,
    }, ['deviceId']);
    if (dto.eventType === 'base_url_changed') {
      await this.events.save(this.events.create({
        deviceId: dto.deviceId,
        platform: dto.platform,
        eventType: dto.eventType,
      }));
    }
    return { ok: true };
  }
}
