import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceInstallationEntity } from './entities/device-installation.entity';
import { DeviceTelemetryEventEntity } from './entities/device-telemetry-event.entity';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceInstallationEntity, DeviceTelemetryEventEntity])],
  controllers: [TelemetryController],
  providers: [TelemetryService],
})
export class TelemetryModule {}
