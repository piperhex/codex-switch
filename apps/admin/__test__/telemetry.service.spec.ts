import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceInstallationEntity } from '@/modules/telemetry/entities/device-installation.entity';
import type { DeviceTelemetryEventEntity } from '@/modules/telemetry/entities/device-telemetry-event.entity';
import { TelemetryController } from '@/modules/telemetry/telemetry.controller';
import { TelemetryService } from '@/modules/telemetry/telemetry.service';

describe('TelemetryService', () => {
  it('stores installation events idempotently by device ID', async () => {
    const installations = { upsert: vi.fn().mockResolvedValue({}) };
    const events = { create: vi.fn((value) => value), save: vi.fn() };
    const service = new TelemetryService(
      installations as unknown as Repository<DeviceInstallationEntity>,
      events as unknown as Repository<DeviceTelemetryEventEntity>,
    );
    const event = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'windows' as const,
      eventType: 'installation' as const,
    };

    await expect(service.recordInstallation(event)).resolves.toEqual({ ok: true });
    expect(installations.upsert).toHaveBeenCalledWith({
      deviceId: event.deviceId,
      platform: event.platform,
    }, ['deviceId']);
    expect(events.save).not.toHaveBeenCalled();
  });

  it('records every base URL change as a separate event', async () => {
    const installations = { upsert: vi.fn().mockResolvedValue({}) };
    const events = { create: vi.fn((value) => value), save: vi.fn().mockResolvedValue({}) };
    const service = new TelemetryService(
      installations as unknown as Repository<DeviceInstallationEntity>,
      events as unknown as Repository<DeviceTelemetryEventEntity>,
    );
    const event = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'macos' as const,
      eventType: 'base_url_changed' as const,
    };

    await expect(service.recordInstallation(event)).resolves.toEqual({ ok: true });
    expect(events.save).toHaveBeenCalledWith(event);
  });
});

describe('TelemetryController', () => {
  it('delegates installation events to the service', async () => {
    const telemetry = { recordInstallation: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new TelemetryController(telemetry as unknown as TelemetryService);
    const event = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'linux' as const,
      eventType: 'base_url_changed' as const,
    };

    await expect(controller.recordInstallation(event)).resolves.toEqual({ ok: true });
    expect(telemetry.recordInstallation).toHaveBeenCalledWith(event);
  });
});
