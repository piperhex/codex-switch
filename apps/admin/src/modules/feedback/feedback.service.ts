import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import nodemailer, { type Transporter } from 'nodemailer';
import { Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type {
  CreateFeedbackDto,
  ListFeedbackQueryDto,
  SendFeedbackEmailDto,
} from './dto/feedback.dto';
import { FeedbackAttachmentEntity } from './entities/feedback-attachment.entity';
import { FeedbackEntity } from './entities/feedback.entity';

export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_FEEDBACK_IMAGES = 4;
export const FEEDBACK_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadedFeedbackImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class FeedbackService {
  private readonly transporter?: Transporter;

  constructor(
    @InjectRepository(FeedbackEntity)
    private readonly feedback: Repository<FeedbackEntity>,
    @InjectRepository(FeedbackAttachmentEntity)
    private readonly attachments: Repository<FeedbackAttachmentEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
    @Inject(MODULE_OPTIONS_TOKEN) private readonly config: ConfigModuleOptions,
  ) {
    if ((config.mail__transport ?? '').toUpperCase() === 'SMTP') {
      this.transporter = nodemailer.createTransport({
        host: config.mail__options__host,
        port: Number(config.mail__options__port ?? 465),
        secure: this.boolean(config.mail__options__secure, true),
        auth: {
          user: config.mail__options__auth__user,
          pass: config.mail__options__auth__pass,
        },
      });
    }
  }

  async create(dto: CreateFeedbackDto, images: UploadedFeedbackImage[], user?: AuthUser) {
    const content = dto.content.trim();
    const version = dto.version.trim();
    const platform = dto.platform.trim();
    if (!content) throw new BadRequestException('Feedback content is required');
    if (!version) throw new BadRequestException('Feedback version is required');
    if (!platform) throw new BadRequestException('Feedback platform is required');
    this.validateImages(images);

    const entity = this.feedback.create({
      content,
      version,
      platform,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      attachments: images.map((image) => this.attachments.create({
        fileName: image.originalname.slice(0, 255) || 'feedback-image',
        mimeType: image.mimetype,
        size: image.size,
        data: image.buffer,
      })),
    });
    const saved = await this.feedback.save(entity);
    return { id: saved.id, createdAt: saved.createdAt.toISOString() };
  }

  async list(query: ListFeedbackQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.feedback.findAndCount({
      relations: { attachments: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: items.map((item) => this.present(item)), total, page, pageSize };
  }

  async get(id: string) {
    const feedback = await this.feedback.findOne({
      where: { id },
      relations: { attachments: true },
    });
    if (!feedback) throw new NotFoundException('Feedback does not exist');
    return this.present(feedback);
  }

  async getAttachment(feedbackId: string, attachmentId: string) {
    const attachment = await this.attachments.createQueryBuilder('attachment')
      .addSelect('attachment.data')
      .where('attachment.id = :attachmentId', { attachmentId })
      .andWhere('attachment.feedbackId = :feedbackId', { feedbackId })
      .getOne();
    if (!attachment) throw new NotFoundException('Feedback attachment does not exist');
    return attachment;
  }

  async sendEmail(actor: AuthUser, id: string, dto: SendFeedbackEmailDto) {
    this.ensureMailConfigured();
    const feedback = await this.feedback.findOne({ where: { id } });
    if (!feedback) throw new NotFoundException('Feedback does not exist');
    if (!feedback.email) throw new BadRequestException('This feedback has no contact email');
    const subject = dto.subject.trim();
    const content = dto.content.trim();
    if (!subject || !content) throw new BadRequestException('Email subject and content are required');

    try {
      await this.transporter!.sendMail({
        from: this.config.mail__from,
        to: feedback.email,
        subject,
        text: content,
      });
    } catch {
      throw new ServiceUnavailableException('Feedback email could not be sent');
    }

    feedback.lastRepliedAt = new Date();
    feedback.lastRepliedById = actor.id;
    feedback.lastRepliedByEmail = actor.email;
    await this.feedback.save(feedback);
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'feedback.email.send',
      targetType: 'feedback',
      targetId: feedback.id,
      targetEmail: feedback.email,
      metadata: { subject },
    }));
    return { ok: true, lastRepliedAt: feedback.lastRepliedAt.toISOString() };
  }

  private validateImages(images: UploadedFeedbackImage[]) {
    if (images.length > MAX_FEEDBACK_IMAGES) {
      throw new BadRequestException(`At most ${MAX_FEEDBACK_IMAGES} images are allowed`);
    }
    for (const image of images) {
      if (!FEEDBACK_IMAGE_MIME_TYPES.has(image.mimetype)) {
        throw new BadRequestException('Only JPEG, PNG and WebP images are supported');
      }
      if (!this.hasValidImageSignature(image)) {
        throw new BadRequestException('Feedback image data is invalid');
      }
      if (image.size > MAX_FEEDBACK_IMAGE_BYTES || image.buffer.length > MAX_FEEDBACK_IMAGE_BYTES) {
        throw new BadRequestException('Each feedback image must not exceed 5 MB');
      }
    }
  }

  private hasValidImageSignature(image: UploadedFeedbackImage) {
    const { buffer, mimetype } = image;
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

  private present(feedback: FeedbackEntity) {
    return {
      id: feedback.id,
      content: feedback.content,
      version: feedback.version,
      platform: feedback.platform,
      email: feedback.email ?? null,
      attachments: (feedback.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      lastRepliedAt: feedback.lastRepliedAt?.toISOString() ?? null,
      lastRepliedByEmail: feedback.lastRepliedByEmail ?? null,
      createdAt: feedback.createdAt.toISOString(),
    };
  }

  private ensureMailConfigured() {
    if (
      !this.transporter
      || !this.config.mail__options__host
      || !this.config.mail__options__auth__user
      || !this.config.mail__options__auth__pass
      || !this.config.mail__from
    ) {
      throw new ServiceUnavailableException('Email service is not configured');
    }
  }

  private boolean(value: string | undefined, fallback: boolean) {
    if (value === undefined) return fallback;
    return value.trim().toLowerCase() === 'true';
  }
}
