import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { MailService } from '@/modules/mail/mail.service';
import type { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { EmailTemplateEntity } from './entities/email-template.entity';
import {
  EMAIL_TEMPLATE_REGISTRY,
  findEmailTemplateDefinition,
  OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE,
  type EmailTemplateDefinition,
} from './email-template.registry';

export interface OfficialAccountBoundNotification {
  recipientEmail: string;
  accountEmails: string[];
  operatorEmail: string;
  boundAt?: Date;
}

type TemplateValues = Record<string, string | number>;

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(
    @InjectRepository(EmailTemplateEntity)
    private readonly templates: Repository<EmailTemplateEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
    private readonly mail: MailService,
  ) {}

  async list() {
    const saved = await this.templates.find({
      where: { code: In(EMAIL_TEMPLATE_REGISTRY.map((definition) => definition.code)) },
    });
    const savedByCode = new Map(saved.map((template) => [template.code, template]));
    return EMAIL_TEMPLATE_REGISTRY.map((definition) => this.present(
      definition,
      savedByCode.get(definition.code),
    ));
  }

  async get(code: string) {
    const definition = this.requireDefinition(code);
    const saved = await this.templates.findOne({ where: { code } });
    return this.present(definition, saved);
  }

  async update(actor: AuthUser, code: string, dto: UpdateEmailTemplateDto) {
    const definition = this.requireDefinition(code);
    const subject = dto.subject.trim();
    const body = dto.body.trim();
    if (!subject || !body) {
      throw new BadRequestException('Email template subject and body are required');
    }
    if (/[\r\n]/.test(subject)) {
      throw new BadRequestException('Email template subject must be a single line');
    }
    this.validateVariables(definition, subject);
    this.validateVariables(definition, body);
    await this.mail.assertSelectable(dto.mailServiceId);

    const existing = await this.templates.findOne({ where: { code } });
    const template = existing ?? this.templates.create({ code });
    template.subject = subject;
    template.body = body;
    template.mailServiceId = dto.mailServiceId ?? null;
    template.updatedById = actor.id;
    template.updatedByEmail = actor.email;
    const saved = await this.templates.save(template);

    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'email-template.update',
      targetType: 'email-template',
      targetId: code,
      metadata: {},
    }));

    return this.present(definition, saved);
  }

  async sendOfficialAccountBound(notification: OfficialAccountBoundNotification) {
    if (!notification.accountEmails.length) return { ok: true };
    const definition = this.requireDefinition(OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE);
    const saved = await this.templates.findOne({
      where: { code: OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE },
    });
    const values: TemplateValues = {
      userEmail: notification.recipientEmail,
      accountCount: notification.accountEmails.length,
      accountEmails: notification.accountEmails.map((email) => `- ${email}`).join('\n'),
      operatorEmail: notification.operatorEmail,
      boundAt: this.formatDate(notification.boundAt ?? new Date()),
    };
    const subject = this.render(saved?.subject ?? definition.defaultSubject, values);
    const body = this.render(saved?.body ?? definition.defaultBody, values);

    try {
      await this.mail.send({
        serviceId: saved?.mailServiceId,
        to: notification.recipientEmail.trim().toLowerCase(),
        subject,
        text: body,
        html: this.toHtml(body),
      });
    } catch (error) {
      this.logger.error(
        `Could not send official account binding notification to ${notification.recipientEmail}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Account binding notification email could not be sent');
    }
    return { ok: true };
  }

  private present(definition: EmailTemplateDefinition, saved?: EmailTemplateEntity | null) {
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      subject: saved?.subject ?? definition.defaultSubject,
      body: saved?.body ?? definition.defaultBody,
      mailServiceId: saved?.mailServiceId ?? null,
      variables: definition.variables,
      customized: Boolean(saved),
      updatedByEmail: saved?.updatedByEmail || null,
      updatedAt: saved?.updatedAt?.toISOString() ?? null,
    };
  }

  private requireDefinition(code: string) {
    const definition = findEmailTemplateDefinition(code);
    if (!definition) throw new NotFoundException('Email template type does not exist');
    return definition;
  }

  private validateVariables(definition: EmailTemplateDefinition, value: string) {
    const supported = new Set(definition.variables.map((variable) => variable.key));
    const unknown = [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)]
      .map((match) => match[1].trim())
      .filter((key) => !supported.has(key));
    if (unknown.length) {
      throw new BadRequestException(`Unsupported email template variable: ${unknown[0]}`);
    }
  }

  private render(template: string, values: TemplateValues) {
    return template.replace(/{{\s*([^{}]+?)\s*}}/g, (placeholder, key: string) => (
      Object.prototype.hasOwnProperty.call(values, key.trim())
        ? String(values[key.trim()])
        : placeholder
    ));
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date).replaceAll('/', '-') + ' (Asia/Singapore)';
  }

  private toHtml(body: string) {
    const escaped = body
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
      .replaceAll('\n', '<br>');
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;font-size:15px;line-height:1.8;color:#24292f">${escaped}</div>`;
  }

}
