import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { AnnouncementController } from '@/modules/announcement/announcement.controller';
import { AnnouncementService } from '@/modules/announcement/announcement.service';
import type { AppAnnouncementEntity } from '@/modules/announcement/entities/app-announcement.entity';
import type { AnnouncementLinkClickEntity } from '@/modules/announcement/entities/announcement-link-click.entity';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';

function createService() {
  const announcements = {
    findOne: vi.fn(),
    create: vi.fn((value) => value),
    save: vi.fn(),
  };
  const auditLogs = {
    create: vi.fn((value) => value),
    save: vi.fn(),
  };
  const clicks = {
    create: vi.fn((value) => value),
    save: vi.fn(),
    count: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const service = new AnnouncementService(
    announcements as unknown as Repository<AppAnnouncementEntity>,
    auditLogs as unknown as Repository<AdminAuditLogEntity>,
    clicks as unknown as Repository<AnnouncementLinkClickEntity>,
  );
  return { service, announcements, auditLogs, clicks };
}

describe('AnnouncementService', () => {
  const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

  it('returns a disabled default announcement when none is configured', async () => {
    const { service, announcements } = createService();
    announcements.findOne.mockResolvedValue(null);

    await expect(service.getPublic()).resolves.toEqual({
      content: '',
      contentZh: '',
      contentEn: '',
      link: '',
      enabled: false,
      textColor: '#C4D7C8',
      backgroundColor: '#203128',
      scrollDurationSeconds: 22,
      updatedAt: null,
    });
  });

  it('returns both localized messages and the trimmed banner link publicly', async () => {
    const { service, announcements } = createService();
    const updatedAt = new Date('2026-07-18T01:00:00.000Z');
    announcements.findOne.mockResolvedValue({
      contentZh: '  系统维护通知  ',
      contentEn: '  System maintenance notice  ',
      link: '  https://status.example.com  ',
      enabled: true,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      scrollDurationSeconds: 18,
      updatedAt,
    });

    await expect(service.getPublic()).resolves.toEqual({
      content: '系统维护通知',
      contentZh: '系统维护通知',
      contentEn: 'System maintenance notice',
      link: 'https://status.example.com',
      enabled: true,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      scrollDurationSeconds: 18,
      updatedAt: updatedAt.toISOString(),
    });
  });

  it('trims content, normalizes colors, and records an audit entry', async () => {
    const { service, announcements, auditLogs } = createService();
    const updatedAt = new Date('2026-07-17T12:00:00.000Z');
    announcements.findOne.mockResolvedValue(null);
    announcements.save.mockImplementation(async (value) => ({ ...value, updatedAt }));

    await expect(service.update(actor, {
      contentZh: '  今晚服务维护  ',
      contentEn: '  Service maintenance tonight  ',
      link: '  https://status.example.com/maintenance  ',
      enabled: true,
      textColor: '#aabbcc',
      backgroundColor: '#112233',
      scrollDurationSeconds: 15,
    })).resolves.toEqual({
      content: '今晚服务维护',
      contentZh: '今晚服务维护',
      contentEn: 'Service maintenance tonight',
      link: 'https://status.example.com/maintenance',
      enabled: true,
      textColor: '#AABBCC',
      backgroundColor: '#112233',
      scrollDurationSeconds: 15,
      updatedAt: updatedAt.toISOString(),
    });

    expect(announcements.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'current' }));
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'announcement.update',
      targetId: 'current',
      metadata: { enabled: true, scrollDurationSeconds: 15 },
    }));
  });

  it('rejects publishing an empty announcement', async () => {
    const { service } = createService();

    await expect(service.update(actor, {
      contentZh: '维护通知',
      contentEn: '   ',
      link: '',
      enabled: true,
      textColor: '#C4D7C8',
      backgroundColor: '#203128',
      scrollDurationSeconds: 22,
    })).rejects.toThrow('Chinese and English announcement content are required when enabled');
  });

  it('records each link click with platform, device ID and authenticated email', async () => {
    const { service, clicks } = createService();
    const dto = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'windows' as const,
      link: ' https://status.example.com/notice ',
      announcementUpdatedAt: '2026-07-18T01:00:00.000Z',
    };

    await expect(service.recordClick(dto, actor)).resolves.toEqual({ ok: true });
    expect(clicks.create).toHaveBeenCalledWith({
      deviceId: dto.deviceId,
      platform: 'windows',
      email: 'admin@example.com',
      link: 'https://status.example.com/notice',
      announcementUpdatedAt: new Date(dto.announcementUpdatedAt),
    });
    expect(clicks.save).toHaveBeenCalledOnce();
  });

  it('summarizes total, recent and per-platform link clicks', async () => {
    const { service, clicks } = createService();
    const recentBuilder = {
      where: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(4),
    };
    const platformBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        { platform: 'windows', count: '6' },
        { platform: 'macos', count: '2' },
      ]),
    };
    clicks.count.mockResolvedValue(8);
    clicks.createQueryBuilder
      .mockReturnValueOnce(recentBuilder)
      .mockReturnValueOnce(platformBuilder);

    await expect(service.getClickOverview()).resolves.toEqual({
      totalClicks: 8,
      clicksLast30Days: 4,
      platforms: { windows: 6, macos: 2, linux: 0, android: 0, ios: 0 },
    });
    expect(recentBuilder.where).toHaveBeenCalledWith(
      'click.createdAt >= :since',
      { since: expect.any(Date) },
    );
  });
});

describe('AnnouncementController', () => {
  it('delegates public reads and admin updates', async () => {
    const announcements = {
      getPublic: vi.fn().mockResolvedValue('public-announcement'),
      getAdmin: vi.fn().mockResolvedValue('admin-announcement'),
      recordClick: vi.fn().mockResolvedValue({ ok: true }),
      getClickOverview: vi.fn().mockResolvedValue('click-overview'),
      listClicks: vi.fn().mockResolvedValue('click-list'),
      update: vi.fn().mockResolvedValue('updated-announcement'),
    };
    const controller = new AnnouncementController(announcements as unknown as AnnouncementService);
    const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    const dto = {
      contentZh: '通知',
      contentEn: 'Notice',
      link: '',
      enabled: true,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      scrollDurationSeconds: 22,
    };
    const clickDto = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'windows' as const,
      link: 'https://status.example.com',
    };
    const clickQuery = { page: 2, platform: 'windows' as const };

    await expect(controller.getCurrent()).resolves.toBe('public-announcement');
    await expect(controller.getAdminConfig()).resolves.toBe('admin-announcement');
    await expect(controller.recordPublicClick(clickDto)).resolves.toEqual({ ok: true });
    await expect(controller.recordAuthenticatedClick(actor, clickDto)).resolves.toEqual({ ok: true });
    await expect(controller.getClickOverview()).resolves.toBe('click-overview');
    await expect(controller.listClicks(clickQuery)).resolves.toBe('click-list');
    await expect(controller.update(actor, dto)).resolves.toBe('updated-announcement');
    expect(announcements.recordClick).toHaveBeenNthCalledWith(1, clickDto);
    expect(announcements.recordClick).toHaveBeenNthCalledWith(2, clickDto, actor);
    expect(announcements.listClicks).toHaveBeenCalledWith(clickQuery);
    expect(announcements.update).toHaveBeenCalledWith(actor, dto);
  });
});
