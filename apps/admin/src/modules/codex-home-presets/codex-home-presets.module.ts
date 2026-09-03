import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { CodexHomePresetsController } from './codex-home-presets.controller';
import { CodexHomePresetsService } from './codex-home-presets.service';
import { CodexHomePresetSettingsEntity } from './entities/codex-home-preset-settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CodexHomePresetSettingsEntity, AdminAuditLogEntity])],
  controllers: [CodexHomePresetsController],
  providers: [CodexHomePresetsService],
})
export class CodexHomePresetsModule {}
