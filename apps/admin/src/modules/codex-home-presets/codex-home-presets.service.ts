import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type { CodexHomePresetDto } from './dto/codex-home-presets.dto';
import {
  CodexHomePresetSettingsEntity,
  type CodexHomePresetItem,
} from './entities/codex-home-preset-settings.entity';

const SETTINGS_ID = 'current';
const MAX_PRESETS = 20;

@Injectable()
export class CodexHomePresetsService {
  constructor(
    @InjectRepository(CodexHomePresetSettingsEntity)
    private readonly settings: Repository<CodexHomePresetSettingsEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
  ) {}

  async getPublic(platform: 'windows' | 'macos') {
    const setting = await this.findSettings();
    return (setting?.presets ?? [])
      .filter((preset) => preset.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        path: platform === 'macos' ? preset.macosPath : preset.windowsPath,
      }));
  }

  async getAdmin() {
    const setting = await this.findSettings();
    return {
      presets: setting?.presets ?? [],
      updatedAt: setting?.updatedAt?.toISOString() ?? null,
    };
  }

  async update(actor: AuthUser, requested: CodexHomePresetDto[]) {
    const presets = this.normalize(requested);
    const setting = await this.findSettings()
      ?? this.settings.create({ id: SETTINGS_ID, presets });
    setting.presets = presets;
    setting.updatedById = actor.id;
    setting.updatedByEmail = actor.email;
    const saved = await this.settings.save(setting);
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'codex-home-presets.update',
      targetType: 'codex-home-presets',
      targetId: SETTINGS_ID,
      metadata: { presetCount: presets.length },
    }));
    return { presets: saved.presets, updatedAt: saved.updatedAt.toISOString() };
  }

  private normalize(requested: CodexHomePresetDto[]): CodexHomePresetItem[] {
    if (requested.length > MAX_PRESETS) {
      throw new BadRequestException(`No more than ${MAX_PRESETS} presets are allowed`);
    }
    const ids = new Set<string>();
    return requested.map((preset) => {
      const normalized = {
        ...preset,
        id: preset.id.trim(),
        name: preset.name.trim(),
        windowsPath: preset.windowsPath.trim(),
        macosPath: preset.macosPath.trim(),
      };
      if (ids.has(normalized.id)) {
        throw new BadRequestException('Preset IDs must be unique');
      }
      ids.add(normalized.id);
      return normalized;
    });
  }

  private findSettings() {
    return this.settings.findOne({ where: { id: SETTINGS_ID } });
  }
}
