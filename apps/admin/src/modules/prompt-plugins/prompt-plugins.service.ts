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
import { CreatePromptPluginDto } from './dto/create-prompt-plugin.dto';
import type {
  ListAdminPromptPluginsQueryDto,
  UpdateAdminPromptPluginDto,
} from './dto/admin-prompt-plugin.dto';
import { PromptPluginItemEntity, type PromptPluginType } from './entities/prompt-plugin-item.entity';

export const MAX_PROMPT_PLUGIN_FILTER_TEXT = 500;
export const MAX_PROMPT_PLUGIN_INJECTION_TEXT = 5000;

export type PromptPluginMarketItem = ReturnType<PromptPluginsService['present']>;

export function validatePromptPluginInput(dto: CreatePromptPluginDto) {
  const name = dto.name.trim();
  const version = dto.version.trim();
  const text = dto.text.trim();
  if (!name || !version || !text) throw new BadRequestException('Prompt plugin fields are required');
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/.test(version)) {
    throw new BadRequestException('Prompt plugin version contains unsupported characters');
  }
  const limit = dto.type === 'filter' ? MAX_PROMPT_PLUGIN_FILTER_TEXT : MAX_PROMPT_PLUGIN_INJECTION_TEXT;
  if (Array.from(text).length > limit) {
    throw new BadRequestException(`Prompt plugin ${dto.type} text must not exceed ${limit} characters`);
  }
  return { name, version, type: dto.type as PromptPluginType, text };
}

@Injectable()
export class PromptPluginsService {
  constructor(
    @InjectRepository(PromptPluginItemEntity)
    private readonly plugins: Repository<PromptPluginItemEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
  ) {}

  async list() {
    const items = await this.plugins.find({ order: { createdAt: 'DESC' }, take: 200 });
    return { items: items.map((item) => this.present(item)) };
  }

  async create(actor: AuthUser, dto: CreatePromptPluginDto) {
    const input = validatePromptPluginInput(dto);
    const entity = this.plugins.create({ ...input, uploaderId: actor.id, uploaderEmail: actor.email });
    return this.present(await this.plugins.save(entity));
  }

  async update(actor: AuthUser, id: string, dto: CreatePromptPluginDto) {
    const plugin = await this.plugins.findOne({ where: { id } });
    if (!plugin) throw new NotFoundException('Prompt plugin does not exist');
    if (plugin.uploaderId !== actor.id) throw new ForbiddenException('Only the publisher can modify this prompt plugin');
    const input = validatePromptPluginInput(dto);
    if (input.version === plugin.version) throw new BadRequestException('A new release must use a different version');
    Object.assign(plugin, input);
    return this.present(await this.plugins.save(plugin));
  }

  async install(id: string) {
    const plugin = await this.plugins.findOne({ where: { id } });
    if (!plugin) throw new NotFoundException('Prompt plugin does not exist');
    await this.plugins.increment({ id }, 'installCount', 1);
    return this.present(plugin);
  }

  async listForAdmin(query: ListAdminPromptPluginsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where = search
      ? [
        { name: ILike(`%${search}%`) },
        { text: ILike(`%${search}%`) },
        { uploaderEmail: ILike(`%${search}%`) },
      ]
      : {};
    const [items, total] = await this.plugins.findAndCount({
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

  async updateForAdmin(actor: AuthUser, id: string, dto: UpdateAdminPromptPluginDto) {
    const plugin = await this.plugins.findOne({ where: { id } });
    if (!plugin) throw new NotFoundException('Prompt plugin does not exist');
    const fields = Object.keys(dto);
    if (!fields.length) {
      throw new BadRequestException('At least one prompt plugin field is required');
    }

    const input = validatePromptPluginInput({
      name: dto.name ?? plugin.name,
      version: dto.version ?? plugin.version,
      type: dto.type ?? plugin.type,
      text: dto.text ?? plugin.text,
    });
    Object.assign(plugin, input);
    const saved = await this.plugins.save(plugin);
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'prompt-plugin.update',
      targetType: 'prompt-plugin',
      targetId: plugin.id,
      targetEmail: plugin.uploaderEmail,
      metadata: { fields },
    }));
    return this.presentForAdmin(saved);
  }

  async deleteForAdmin(actor: AuthUser, id: string) {
    const plugin = await this.plugins.findOne({ where: { id } });
    if (!plugin) throw new NotFoundException('Prompt plugin does not exist');
    await this.plugins.delete({ id });
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'prompt-plugin.delete',
      targetType: 'prompt-plugin',
      targetId: plugin.id,
      targetEmail: plugin.uploaderEmail,
      metadata: { name: plugin.name, version: plugin.version, installCount: plugin.installCount },
    }));
    return { ok: true };
  }

  private present(plugin: PromptPluginItemEntity) {
    return {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      type: plugin.type,
      text: plugin.text,
      uploaderId: plugin.uploaderId ?? null,
      installCount: plugin.installCount ?? 0,
      createdAt: plugin.createdAt.toISOString(),
      updatedAt: plugin.updatedAt.toISOString(),
    };
  }

  private presentForAdmin(plugin: PromptPluginItemEntity) {
    return {
      ...this.present(plugin),
      uploaderEmail: plugin.uploaderEmail,
    };
  }
}
