import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { ILike, Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { getKongJwtSecret } from '@/config/auth-secrets';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type { CreateMailServiceDto, UpdateMailServiceDto } from './dto/mail-service.dto';
import { MailServiceEntity } from './entities/mail-service.entity';

interface MailMessage {
  serviceId?: string | null;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

interface ResolvedMailService {
  transporter: Transporter;
  from: string;
}

@Injectable()
export class MailService {
  private readonly defaultTransporter?: Transporter;
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectRepository(MailServiceEntity)
    private readonly mailServices: Repository<MailServiceEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
    @Inject(MODULE_OPTIONS_TOKEN) private readonly config: ConfigModuleOptions,
  ) {
    this.encryptionKey = createHash('sha256')
      .update(`codex-switch:mail-service:${getKongJwtSecret(config)}`)
      .digest();
    if (this.defaultConfigured()) {
      this.defaultTransporter = this.createTransporter({
        host: config.mail__options__host!,
        port: Number(config.mail__options__port ?? 465),
        secure: this.boolean(config.mail__options__secure, true),
        username: config.mail__options__auth__user!,
        password: config.mail__options__auth__pass!,
      });
    }
  }

  async list() {
    const custom = await this.mailServices.find({ order: { createdAt: 'ASC' } });
    return [this.presentDefault(), ...custom.map((service) => this.present(service))];
  }

  async create(actor: AuthUser, dto: CreateMailServiceDto) {
    await this.assertUniqueName(dto.name);
    const service = this.mailServices.create({
      name: dto.name.trim(),
      host: dto.host.trim(),
      port: dto.port,
      secure: dto.secure,
      username: dto.username.trim(),
      encryptedPassword: this.encrypt(dto.password),
      fromAddress: dto.fromAddress.trim(),
      enabled: dto.enabled,
      createdById: actor.id,
      createdByEmail: actor.email,
      updatedById: actor.id,
      updatedByEmail: actor.email,
    });
    const saved = await this.mailServices.save(service);
    await this.record(actor, 'mail-service.create', saved.id, { name: saved.name });
    return this.present(saved);
  }

  async update(actor: AuthUser, id: string, dto: UpdateMailServiceDto) {
    const service = await this.requireCustom(id, true);
    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== service.name.toLowerCase()) {
      await this.assertUniqueName(dto.name, id);
      service.name = dto.name.trim();
    }
    if (dto.host !== undefined) service.host = dto.host.trim();
    if (dto.port !== undefined) service.port = dto.port;
    if (dto.secure !== undefined) service.secure = dto.secure;
    if (dto.username !== undefined) service.username = dto.username.trim();
    if (dto.password !== undefined) service.encryptedPassword = this.encrypt(dto.password);
    if (dto.fromAddress !== undefined) service.fromAddress = dto.fromAddress.trim();
    if (dto.enabled !== undefined) service.enabled = dto.enabled;
    service.updatedById = actor.id;
    service.updatedByEmail = actor.email;
    const saved = await this.mailServices.save(service);
    await this.record(actor, 'mail-service.update', saved.id, {
      name: saved.name,
      fields: Object.keys(dto).filter((key) => key !== 'password'),
      passwordChanged: dto.password !== undefined,
    });
    return this.present(saved);
  }

  async delete(actor: AuthUser, id: string) {
    const service = await this.requireCustom(id);
    await this.mailServices.delete({ id });
    await this.record(actor, 'mail-service.delete', id, { name: service.name });
    return { id };
  }

  async assertSelectable(serviceId?: string | null) {
    if (!serviceId) return;
    const service = await this.mailServices.findOne({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Mail service does not exist');
    if (!service.enabled) throw new ConflictException('Mail service is disabled');
  }

  async send(message: MailMessage) {
    const service = await this.resolve(message.serviceId);
    try {
      await service.transporter.sendMail({
        from: service.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    } catch {
      throw new ServiceUnavailableException('Email could not be sent');
    }
    return { ok: true };
  }

  private async resolve(serviceId?: string | null): Promise<ResolvedMailService> {
    if (!serviceId) {
      if (!this.defaultTransporter || !this.config.mail__from) {
        throw new ServiceUnavailableException('Default email service is not configured');
      }
      return { transporter: this.defaultTransporter, from: this.config.mail__from };
    }
    const service = await this.requireCustom(serviceId, true);
    if (!service.enabled) throw new ServiceUnavailableException('Selected email service is disabled');
    return {
      transporter: this.createTransporter({
        host: service.host,
        port: service.port,
        secure: service.secure,
        username: service.username,
        password: this.decrypt(service.encryptedPassword),
      }),
      from: service.fromAddress,
    };
  }

  private createTransporter(service: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
  }) {
    return nodemailer.createTransport({
      host: service.host,
      port: service.port,
      secure: service.secure,
      auth: { user: service.username, pass: service.password },
    });
  }

  private presentDefault() {
    return {
      id: null,
      source: 'default' as const,
      name: '环境变量默认服务',
      host: this.config.mail__options__host ?? '',
      port: Number(this.config.mail__options__port ?? 465),
      secure: this.boolean(this.config.mail__options__secure, true),
      username: this.config.mail__options__auth__user ?? '',
      fromAddress: this.config.mail__from ?? '',
      enabled: this.defaultConfigured(),
      hasPassword: Boolean(this.config.mail__options__auth__pass),
      updatedByEmail: null,
      updatedAt: null,
    };
  }

  private present(service: MailServiceEntity) {
    return {
      id: service.id,
      source: 'custom' as const,
      name: service.name,
      host: service.host,
      port: service.port,
      secure: service.secure,
      username: service.username,
      fromAddress: service.fromAddress,
      enabled: service.enabled,
      hasPassword: true,
      updatedByEmail: service.updatedByEmail || null,
      updatedAt: service.updatedAt?.toISOString() ?? null,
    };
  }

  private async requireCustom(id: string, withPassword = false) {
    const service = withPassword
      ? await this.mailServices.createQueryBuilder('service')
        .addSelect('service.encryptedPassword')
        .where('service.id = :id', { id })
        .getOne()
      : await this.mailServices.findOne({ where: { id } });
    if (!service) throw new NotFoundException('Mail service does not exist');
    return service;
  }

  private async assertUniqueName(name: string, excludingId?: string) {
    const existing = await this.mailServices.findOne({ where: { name: ILike(name.trim()) } });
    if (existing && existing.id !== excludingId) {
      throw new ConflictException('Mail service name already exists');
    }
  }

  private encrypt(password: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  private decrypt(value: string) {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !encrypted) {
      throw new ServiceUnavailableException('Stored mail service password is invalid');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Stored mail service password could not be decrypted');
    }
  }

  private defaultConfigured() {
    return (this.config.mail__transport ?? '').toUpperCase() === 'SMTP'
      && Boolean(this.config.mail__options__host)
      && Boolean(this.config.mail__options__auth__user)
      && Boolean(this.config.mail__options__auth__pass)
      && Boolean(this.config.mail__from);
  }

  private boolean(value: string | undefined, fallback: boolean) {
    if (value === undefined) return fallback;
    return value.trim().toLowerCase() === 'true';
  }

  private async record(
    actor: AuthUser,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      targetType: 'mail-service',
      targetId,
      metadata,
    }));
  }
}
