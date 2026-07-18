import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type {
  CreateAnnouncementClickDto,
  ListAnnouncementClicksQueryDto,
} from './dto/announcement-click.dto';
import type { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AnnouncementLinkClickEntity } from './entities/announcement-link-click.entity';
import { AppAnnouncementEntity } from './entities/app-announcement.entity';

const CURRENT_ANNOUNCEMENT_ID = 'current';

export interface AnnouncementResponse {
  /** Kept for compatibility with desktop clients released before localized announcements. */
  content: string;
  contentZh: string;
  contentEn: string;
  link: string;
  enabled: boolean;
  textColor: string;
  backgroundColor: string;
  scrollDurationSeconds: number;
  updatedAt: string | null;
}

const DEFAULT_TEXT_COLOR = '#C4D7C8';
const DEFAULT_BACKGROUND_COLOR = '#203128';
const DEFAULT_SCROLL_DURATION_SECONDS = 22;
const ANNOUNCEMENT_PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'] as const;

interface PlatformCountRow {
  platform: typeof ANNOUNCEMENT_PLATFORMS[number];
  count: string;
}

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(AppAnnouncementEntity)
    private readonly announcements: Repository<AppAnnouncementEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
    @InjectRepository(AnnouncementLinkClickEntity)
    private readonly clicks: Repository<AnnouncementLinkClickEntity>,
  ) {}

  async getPublic(): Promise<AnnouncementResponse> {
    const announcement = await this.findCurrent();
    const contentZh = announcement?.contentZh.trim() ?? '';
    const contentEn = announcement?.contentEn.trim() ?? '';
    const enabled = Boolean(announcement?.enabled && contentZh && contentEn);
    return {
      content: enabled ? contentZh : '',
      contentZh: enabled ? contentZh : '',
      contentEn: enabled ? contentEn : '',
      link: enabled ? announcement!.link.trim() : '',
      enabled,
      textColor: announcement?.textColor ?? DEFAULT_TEXT_COLOR,
      backgroundColor: announcement?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
      scrollDurationSeconds: announcement?.scrollDurationSeconds
        ?? DEFAULT_SCROLL_DURATION_SECONDS,
      updatedAt: announcement?.updatedAt?.toISOString() ?? null,
    };
  }

  async getAdmin(): Promise<AnnouncementResponse> {
    const announcement = await this.findCurrent();
    return {
      content: announcement?.contentZh ?? '',
      contentZh: announcement?.contentZh ?? '',
      contentEn: announcement?.contentEn ?? '',
      link: announcement?.link ?? '',
      enabled: announcement?.enabled ?? false,
      textColor: announcement?.textColor ?? DEFAULT_TEXT_COLOR,
      backgroundColor: announcement?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
      scrollDurationSeconds: announcement?.scrollDurationSeconds
        ?? DEFAULT_SCROLL_DURATION_SECONDS,
      updatedAt: announcement?.updatedAt?.toISOString() ?? null,
    };
  }

  async recordClick(dto: CreateAnnouncementClickDto, user?: AuthUser) {
    const announcementUpdatedAt = dto.announcementUpdatedAt
      ? new Date(dto.announcementUpdatedAt)
      : null;
    await this.clicks.save(this.clicks.create({
      deviceId: dto.deviceId,
      platform: dto.platform,
      email: user?.email ?? null,
      link: dto.link.trim(),
      announcementUpdatedAt,
    }));
    return { ok: true };
  }

  async getClickOverview() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalClicks, clicksLast30Days, platformRows] = await Promise.all([
      this.clicks.count(),
      this.clicks.createQueryBuilder('click')
        .where('click.createdAt >= :since', { since: thirtyDaysAgo })
        .getCount(),
      this.clicks.createQueryBuilder('click')
        .select('click.platform', 'platform')
        .addSelect('COUNT(*)', 'count')
        .groupBy('click.platform')
        .getRawMany<PlatformCountRow>(),
    ]);
    const platforms = Object.fromEntries(
      ANNOUNCEMENT_PLATFORMS.map((platform) => [platform, 0]),
    ) as Record<typeof ANNOUNCEMENT_PLATFORMS[number], number>;
    for (const row of platformRows) platforms[row.platform] = Number(row.count);
    return { totalClicks, clicksLast30Days, platforms };
  }

  async listClicks(query: ListAnnouncementClicksQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const builder = this.clicks.createQueryBuilder('click');
    const search = query.search?.trim();
    if (search) {
      builder.andWhere(
        '(CAST(click.deviceId AS text) ILIKE :search OR click.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (query.platform) {
      builder.andWhere('click.platform = :platform', { platform: query.platform });
    }
    const [items, total] = await builder
      .orderBy('click.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async update(actor: AuthUser, dto: UpdateAnnouncementDto): Promise<AnnouncementResponse> {
    const contentZh = dto.contentZh.trim();
    const contentEn = dto.contentEn.trim();
    const link = dto.link.trim();
    if (dto.enabled && (!contentZh || !contentEn)) {
      throw new BadRequestException(
        'Chinese and English announcement content are required when enabled',
      );
    }

    const existing = await this.findCurrent();
    const announcement = existing ?? this.announcements.create({ id: CURRENT_ANNOUNCEMENT_ID });
    announcement.contentZh = contentZh;
    announcement.contentEn = contentEn;
    announcement.link = link;
    announcement.enabled = dto.enabled;
    announcement.textColor = dto.textColor.toUpperCase();
    announcement.backgroundColor = dto.backgroundColor.toUpperCase();
    announcement.scrollDurationSeconds = dto.scrollDurationSeconds;
    announcement.updatedById = actor.id;
    announcement.updatedByEmail = actor.email;
    const saved = await this.announcements.save(announcement);

    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'announcement.update',
      targetType: 'announcement',
      targetId: CURRENT_ANNOUNCEMENT_ID,
      metadata: {
        enabled: saved.enabled,
        scrollDurationSeconds: saved.scrollDurationSeconds,
      },
    }));

    return {
      content: saved.contentZh,
      contentZh: saved.contentZh,
      contentEn: saved.contentEn,
      link: saved.link,
      enabled: saved.enabled,
      textColor: saved.textColor,
      backgroundColor: saved.backgroundColor,
      scrollDurationSeconds: saved.scrollDurationSeconds,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  private findCurrent() {
    return this.announcements.findOne({ where: { id: CURRENT_ANNOUNCEMENT_ID } });
  }
}
