import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { CodexHomePresetsService } from '@/modules/codex-home-presets/codex-home-presets.service';
import type {
  CodexHomePresetSettingsEntity,
} from '@/modules/codex-home-presets/entities/codex-home-preset-settings.entity';

function createService() {
  const settings = {
    findOne: vi.fn(),
    create: vi.fn((value) => value),
    save: vi.fn(),
  };
  const auditLogs = {
    create: vi.fn((value) => value),
    save: vi.fn(),
  };
  const service = new CodexHomePresetsService(
    settings as unknown as Repository<CodexHomePresetSettingsEntity>,
    auditLogs as unknown as Repository<AdminAuditLogEntity>,
  );
  return { auditLogs, service, settings };
}

describe('CodexHomePresetsService', () => {
  const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

  it('returns only enabled paths for the requested platform in display order', async () => {
    const { service, settings } = createService();
    settings.findOne.mockResolvedValue({
      presets: [
        {
          id: 'second', name: 'Second', windowsPath: 'C:\\second', macosPath: '~/second',
          enabled: true, sortOrder: 20,
        },
        {
          id: 'hidden', name: 'Hidden', windowsPath: 'C:\\hidden', macosPath: '~/hidden',
          enabled: false, sortOrder: 0,
        },
        {
          id: 'first', name: 'First', windowsPath: 'C:\\first', macosPath: '~/first',
          enabled: true, sortOrder: 10,
        },
      ],
    });

    await expect(service.getPublic('macos')).resolves.toEqual([
      { id: 'first', name: 'First', path: '~/first' },
      { id: 'second', name: 'Second', path: '~/second' },
    ]);
  });

  it('normalizes and saves both platform paths', async () => {
    const { auditLogs, service, settings } = createService();
    settings.findOne.mockResolvedValue(null);
    settings.save.mockImplementation(async (value) => ({
      ...value,
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    }));
    auditLogs.save.mockResolvedValue(undefined);

    const result = await service.update(actor, [{
      id: ' default ',
      name: ' Default ',
      windowsPath: ' %USERPROFILE%\\.codex ',
      macosPath: ' ~/.codex ',
      enabled: true,
      sortOrder: 0,
    }]);

    expect(result.presets[0]).toMatchObject({
      id: 'default',
      name: 'Default',
      windowsPath: '%USERPROFILE%\\.codex',
      macosPath: '~/.codex',
    });
    expect(auditLogs.save).toHaveBeenCalledOnce();
  });

  it('rejects duplicate preset IDs', async () => {
    const { service, settings } = createService();
    settings.findOne.mockResolvedValue(null);
    const preset = {
      id: 'same', name: 'Path', windowsPath: 'C:\\path', macosPath: '~/path',
      enabled: true, sortOrder: 0,
    };
    await expect(service.update(actor, [preset, preset])).rejects.toThrow('Preset IDs must be unique');
  });
});
