import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type {
  ListAdminSkillsQueryDto,
  UpdateAdminSkillDto,
} from './dto/admin-skill.dto';
import type { CreateSkillDto } from './dto/create-skill.dto';
import { SkillMarketItemEntity } from './entities/skill-market-item.entity';

export const MAX_SKILL_ARCHIVE_BYTES = 1024 * 1024;
export const MAX_SKILL_PREVIEW_BYTES = 1024 * 1024;
const MAX_SKILL_EXPANDED_BYTES = 10 * 1024 * 1024;
const MAX_SKILL_ARCHIVE_ENTRIES = 512;
export const SKILL_PREVIEW_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadedSkillFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

function findEndOfCentralDirectory(archive: Buffer) {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

export function validateSkillArchive(archive: Buffer) {
  if (!archive.length || archive.length > MAX_SKILL_ARCHIVE_BYTES) {
    throw new BadRequestException('Skill archive must not exceed 1 MB');
  }
  const eocd = findEndOfCentralDirectory(archive);
  if (eocd < 0 || archive.readUInt16LE(eocd + 4) !== 0 || archive.readUInt16LE(eocd + 6) !== 0) {
    throw new BadRequestException('Skill archive is not a supported ZIP file');
  }
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = archive.readUInt32LE(eocd + 16);
  if (entryCount === 0 || entryCount > MAX_SKILL_ARCHIVE_ENTRIES) {
    throw new BadRequestException(`Skill archive must contain 1-${MAX_SKILL_ARCHIVE_ENTRIES} entries`);
  }

  let offset = centralDirectoryOffset;
  let expandedBytes = 0;
  const skillFiles: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new BadRequestException('Skill archive central directory is invalid');
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > archive.length) {
      throw new BadRequestException('Skill archive entry name is invalid');
    }
    const name = archive.subarray(offset + 46, nameEnd).toString('utf8').replaceAll('\\', '/');
    const parts = name.split('/').filter(Boolean);
    if (
      !name
      || name.startsWith('/')
      || /^[a-z]:/i.test(name)
      || parts.some((part) => part === '..')
    ) {
      throw new BadRequestException('Skill archive contains an unsafe path');
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new BadRequestException('Skill archive must not contain symbolic links');
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > MAX_SKILL_EXPANDED_BYTES) {
      throw new BadRequestException('Expanded skill archive must not exceed 10 MB');
    }
    if (!name.endsWith('/') && parts.at(-1)?.toLowerCase() === 'skill.md') {
      skillFiles.push(parts.join('/'));
    }
    offset = nameEnd + extraLength + commentLength;
  }
  if (skillFiles.length !== 1) {
    throw new BadRequestException('Skill archive must contain exactly one SKILL.md file');
  }
}

function hasValidImageSignature(file: UploadedSkillFile) {
  const { buffer, mimetype } = file;
  if (mimetype === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

@Injectable()
export class SkillsService {
  constructor(
    @InjectRepository(SkillMarketItemEntity)
    private readonly skills: Repository<SkillMarketItemEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
  ) {}

  async create(
    actor: AuthUser,
    dto: CreateSkillDto,
    archive: UploadedSkillFile | undefined,
    preview: UploadedSkillFile | undefined,
  ) {
    const title = dto.title.trim();
    const description = dto.description.trim();
    const version = this.validateVersion(dto.version);
    if (!title || !description) throw new BadRequestException('Skill title and description are required');
    if (!archive) throw new BadRequestException('Skill archive is required');
    if (archive.size > MAX_SKILL_ARCHIVE_BYTES || archive.buffer.length > MAX_SKILL_ARCHIVE_BYTES) {
      throw new BadRequestException('Skill archive must not exceed 1 MB');
    }
    validateSkillArchive(archive.buffer);
    if (preview) this.validatePreview(preview);

    const entity = this.skills.create({
      title,
      description,
      version,
      archiveFileName: archive.originalname.slice(0, 255) || 'skill.zip',
      archiveMimeType: 'application/zip',
      archiveSize: archive.buffer.length,
      archiveSha256: createHash('sha256').update(archive.buffer).digest('hex'),
      archiveData: archive.buffer,
      previewMimeType: preview?.mimetype ?? null,
      previewSize: preview?.buffer.length ?? null,
      previewData: preview?.buffer ?? null,
      uploaderId: actor.id,
      uploaderEmail: actor.email,
    });
    return this.present(await this.skills.save(entity));
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: CreateSkillDto,
    archive: UploadedSkillFile | undefined,
    preview: UploadedSkillFile | undefined,
  ) {
    const skill = await this.skills.findOne({ where: { id } });
    if (!skill) throw new NotFoundException('Skill does not exist');
    if (skill.uploaderId !== actor.id) {
      throw new ForbiddenException('Only the publisher can modify this skill');
    }
    const title = dto.title.trim();
    const description = dto.description.trim();
    const version = this.validateVersion(dto.version);
    if (!title || !description) throw new BadRequestException('Skill title and description are required');
    if (version === skill.version) {
      throw new BadRequestException('A new release must use a different version');
    }
    if (!archive) throw new BadRequestException('A skill archive is required for a new version');
    if (archive.size > MAX_SKILL_ARCHIVE_BYTES || archive.buffer.length > MAX_SKILL_ARCHIVE_BYTES) {
      throw new BadRequestException('Skill archive must not exceed 1 MB');
    }
    validateSkillArchive(archive.buffer);
    if (preview) this.validatePreview(preview);

    skill.title = title;
    skill.description = description;
    skill.version = version;
    skill.archiveFileName = archive.originalname.slice(0, 255) || 'skill.zip';
    skill.archiveMimeType = 'application/zip';
    skill.archiveSize = archive.buffer.length;
    skill.archiveSha256 = createHash('sha256').update(archive.buffer).digest('hex');
    skill.archiveData = archive.buffer;
    if (preview) {
      skill.previewMimeType = preview.mimetype;
      skill.previewSize = preview.buffer.length;
      skill.previewData = preview.buffer;
    }
    return this.present(await this.skills.save(skill));
  }

  async list() {
    const items = await this.skills.find({
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return { items: items.map((item) => this.present(item)) };
  }

  async listForAdmin(query: ListAdminSkillsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where = search
      ? [
        { title: ILike(`%${search}%`) },
        { description: ILike(`%${search}%`) },
        { uploaderEmail: ILike(`%${search}%`) },
      ]
      : {};
    const [items, total] = await this.skills.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((item) => this.presentForAdmin(item)),
      total,
      page,
      pageSize,
    };
  }

  async updateForAdmin(actor: AuthUser, id: string, dto: UpdateAdminSkillDto) {
    const skill = await this.skills.findOne({ where: { id } });
    if (!skill) throw new NotFoundException('Skill does not exist');
    const fields = Object.keys(dto);
    if (!fields.length) throw new BadRequestException('At least one skill field is required');

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Skill title is required');
      skill.title = title;
    }
    if (dto.description !== undefined) {
      const description = dto.description.trim();
      if (!description) throw new BadRequestException('Skill description is required');
      skill.description = description;
    }
    if (dto.version !== undefined) skill.version = this.validateVersion(dto.version);

    const saved = await this.skills.save(skill);
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'skill.update',
      targetType: 'skill',
      targetId: skill.id,
      targetEmail: skill.uploaderEmail,
      metadata: { fields },
    }));
    return this.presentForAdmin(saved);
  }

  async deleteForAdmin(actor: AuthUser, id: string) {
    const skill = await this.skills.findOne({ where: { id } });
    if (!skill) throw new NotFoundException('Skill does not exist');
    await this.skills.delete({ id });
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'skill.delete',
      targetType: 'skill',
      targetId: skill.id,
      targetEmail: skill.uploaderEmail,
      metadata: {
        title: skill.title,
        version: skill.version,
        uploaderId: skill.uploaderId ?? null,
        installCount: skill.installCount,
      },
    }));
    return { ok: true };
  }

  async getPreview(id: string) {
    const skill = await this.skills.createQueryBuilder('skill')
      .addSelect('skill.previewData')
      .where('skill.id = :id', { id })
      .getOne();
    if (!skill || !skill.previewData || !skill.previewMimeType) {
      throw new NotFoundException('Skill preview does not exist');
    }
    return {
      data: skill.previewData,
      mimeType: skill.previewMimeType,
      size: skill.previewData.length,
    };
  }

  async download(id: string) {
    const skill = await this.skills.createQueryBuilder('skill')
      .addSelect('skill.archiveData')
      .where('skill.id = :id', { id })
      .getOne();
    if (!skill?.archiveData) throw new NotFoundException('Skill does not exist');
    await this.skills.increment({ id }, 'installCount', 1);
    return {
      data: skill.archiveData,
      fileName: skill.archiveFileName,
      sha256: skill.archiveSha256,
    };
  }

  private validatePreview(preview: UploadedSkillFile) {
    if (!SKILL_PREVIEW_MIME_TYPES.has(preview.mimetype)) {
      throw new BadRequestException('Skill preview must be a JPEG, PNG or WebP image');
    }
    if (
      preview.size > MAX_SKILL_PREVIEW_BYTES
      || preview.buffer.length > MAX_SKILL_PREVIEW_BYTES
    ) {
      throw new BadRequestException('Skill preview must not exceed 1 MB');
    }
    if (!hasValidImageSignature(preview)) {
      throw new BadRequestException('Skill preview image data is invalid');
    }
  }

  private validateVersion(value: string) {
    const version = value.trim();
    if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/.test(version)) {
      throw new BadRequestException('Skill version contains unsupported characters');
    }
    return version;
  }

  private present(skill: SkillMarketItemEntity) {
    return {
      id: skill.id,
      title: skill.title,
      description: skill.description,
      version: skill.version,
      archiveSize: skill.archiveSize,
      archiveSha256: skill.archiveSha256,
      hasPreview: Boolean(skill.previewMimeType && skill.previewSize),
      uploaderId: skill.uploaderId,
      installCount: skill.installCount,
      createdAt: skill.createdAt.toISOString(),
      updatedAt: skill.updatedAt.toISOString(),
    };
  }

  private presentForAdmin(skill: SkillMarketItemEntity) {
    return {
      ...this.present(skill),
      uploaderEmail: skill.uploaderEmail,
      archiveFileName: skill.archiveFileName,
    };
  }
}
