import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { SkillMarketItemEntity } from '@/modules/skills/entities/skill-market-item.entity';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import {
  MAX_SKILL_ARCHIVE_BYTES,
  SkillsService,
  validateSkillArchive,
  type UploadedSkillFile,
} from '@/modules/skills/skills.service';

function fakeZip(entryName = 'SKILL.md', uncompressedSize = 24) {
  const name = Buffer.from(entryName);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(uncompressedSize, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(0, 16);
  return Buffer.concat([central, end]);
}

function archive(overrides: Partial<UploadedSkillFile> = {}): UploadedSkillFile {
  const buffer = fakeZip();
  return {
    buffer,
    originalname: 'demo.zip',
    mimetype: 'application/zip',
    size: buffer.length,
    ...overrides,
  };
}

function createService() {
  const skills = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({
      ...value,
      id: value.id ?? 'skill-1',
      installCount: value.installCount ?? 0,
      createdAt: value.createdAt ?? new Date('2026-07-28T01:00:00.000Z'),
      updatedAt: new Date('2026-07-28T01:00:00.000Z'),
    })),
    find: vi.fn(),
    findAndCount: vi.fn(),
    findOne: vi.fn(),
    increment: vi.fn(),
    delete: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const auditLogs = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  return {
    service: new SkillsService(
      skills as unknown as Repository<SkillMarketItemEntity>,
      auditLogs as unknown as Repository<AdminAuditLogEntity>,
    ),
    skills,
    auditLogs,
  };
}

describe('SkillsService', () => {
  it('validates archive structure and expanded-size limits', () => {
    expect(() => validateSkillArchive(fakeZip())).not.toThrow();
    expect(() => validateSkillArchive(fakeZip('README.md'))).toThrow('exactly one SKILL.md');
    expect(() => validateSkillArchive(fakeZip('../SKILL.md'))).toThrow('unsafe path');
    expect(() => validateSkillArchive(fakeZip('SKILL.md', 10 * 1024 * 1024 + 1)))
      .toThrow('must not exceed 10 MB');
    expect(() => validateSkillArchive(Buffer.alloc(MAX_SKILL_ARCHIVE_BYTES + 1)))
      .toThrow('must not exceed 1 MB');
  });

  it('persists publisher ownership, version and archive integrity metadata', async () => {
    const { service, skills } = createService();
    const actor: AuthUser = { id: 'publisher-1', email: 'publisher@example.com', role: 'user' };

    await service.create(actor, {
      title: '  Release helper ',
      description: ' Publish releases safely ',
      version: ' 1.2.0 ',
    }, archive(), undefined);

    expect(skills.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Release helper',
      description: 'Publish releases safely',
      version: '1.2.0',
      uploaderId: actor.id,
      uploaderEmail: actor.email,
      archiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('allows only the original publisher to publish an update', async () => {
    const { service, skills } = createService();
    skills.findOne.mockResolvedValue({
      id: 'skill-1',
      uploaderId: 'publisher-1',
    });

    await expect(service.update(
      { id: 'publisher-2', email: 'other@example.com', role: 'user' },
      'skill-1',
      { title: 'Demo', description: 'Demo skill', version: '2.0.0' },
      archive(),
      undefined,
    )).rejects.toThrow('Only the publisher can modify this skill');
    expect(skills.save).not.toHaveBeenCalled();
  });

  it('requires a distinct version for each publisher update', async () => {
    const { service, skills } = createService();
    skills.findOne.mockResolvedValue({
      id: 'skill-1',
      uploaderId: 'publisher-1',
      version: '1.0.0',
    });

    await expect(service.update(
      { id: 'publisher-1', email: 'publisher@example.com', role: 'user' },
      'skill-1',
      { title: 'Demo', description: 'Demo skill', version: '1.0.0' },
      archive(),
      undefined,
    )).rejects.toThrow('must use a different version');
    expect(skills.save).not.toHaveBeenCalled();
  });

  it('returns download totals in both market and admin list results', async () => {
    const { service, skills } = createService();
    const item = {
      id: 'skill-1',
      title: 'Demo',
      description: 'Demo skill',
      version: '1.0.0',
      archiveFileName: 'demo.zip',
      archiveSize: 123,
      archiveSha256: 'a'.repeat(64),
      previewMimeType: null,
      previewSize: null,
      uploaderId: 'publisher-1',
      uploaderEmail: 'publisher@example.com',
      installCount: 42,
      createdAt: new Date('2026-07-28T01:00:00.000Z'),
      updatedAt: new Date('2026-07-28T02:00:00.000Z'),
    };
    skills.find.mockResolvedValue([item]);
    skills.findAndCount.mockResolvedValue([[item], 1]);

    await expect(service.list()).resolves.toMatchObject({
      items: [{ id: 'skill-1', installCount: 42 }],
    });
    await expect(service.listForAdmin({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: [{
        id: 'skill-1',
        installCount: 42,
        uploaderEmail: 'publisher@example.com',
      }],
      total: 1,
    });
  });

  it('increments the download total when an archive is downloaded', async () => {
    const { service, skills } = createService();
    const builder = {
      addSelect: vi.fn(),
      where: vi.fn(),
      getOne: vi.fn().mockResolvedValue({
        id: 'skill-1',
        archiveData: Buffer.from('archive'),
        archiveFileName: 'demo.zip',
        archiveSha256: 'a'.repeat(64),
      }),
    };
    builder.addSelect.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    skills.createQueryBuilder.mockReturnValue(builder);

    await expect(service.download('skill-1')).resolves.toMatchObject({
      fileName: 'demo.zip',
    });
    expect(skills.increment).toHaveBeenCalledWith({ id: 'skill-1' }, 'installCount', 1);
  });

  it('allows administrators to edit metadata and delete published skills with audit logs', async () => {
    const { service, skills, auditLogs } = createService();
    const skill = {
      id: 'skill-1',
      title: 'Old title',
      description: 'Old description',
      version: '1.0.0',
      archiveFileName: 'demo.zip',
      archiveSize: 123,
      archiveSha256: 'a'.repeat(64),
      previewMimeType: null,
      previewSize: null,
      uploaderId: 'publisher-1',
      uploaderEmail: 'publisher@example.com',
      installCount: 7,
      createdAt: new Date('2026-07-28T01:00:00.000Z'),
      updatedAt: new Date('2026-07-28T02:00:00.000Z'),
    };
    skills.findOne.mockResolvedValue(skill);
    const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

    await service.updateForAdmin(actor, 'skill-1', {
      title: ' Curated title ',
      description: ' Curated description ',
    });
    expect(skills.save).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Curated title',
      description: 'Curated description',
    }));
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'skill.update',
      targetId: 'skill-1',
    }));

    await expect(service.deleteForAdmin(actor, 'skill-1')).resolves.toEqual({ ok: true });
    expect(skills.delete).toHaveBeenCalledWith({ id: 'skill-1' });
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'skill.delete',
      targetEmail: 'publisher@example.com',
    }));
  });
});
