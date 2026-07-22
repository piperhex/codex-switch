import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { EmailTemplateService } from '@/modules/email-template/email-template.service';
import type { EmailTemplateEntity } from '@/modules/email-template/entities/email-template.entity';
import { OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE } from '@/modules/email-template/email-template.registry';
import type { MailService } from '@/modules/mail/mail.service';

describe('EmailTemplateService', () => {
  const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
  let templates: {
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let auditLogs: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let mail: {
    assertSelectable: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    templates = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({
        ...value,
        createdAt: new Date('2026-07-22T01:00:00.000Z'),
        updatedAt: new Date('2026-07-22T01:00:00.000Z'),
      })),
    };
    auditLogs = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
    };
    mail = {
      assertSelectable: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  function createService() {
    return new EmailTemplateService(
      templates as unknown as Repository<EmailTemplateEntity>,
      auditLogs as unknown as Repository<AdminAuditLogEntity>,
      mail as unknown as MailService,
    );
  }

  it('lists registered template types with defaults when no customization exists', async () => {
    const result = await createService().list();

    expect(result).toEqual([
      expect.objectContaining({
        code: OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE,
        customized: false,
        subject: expect.stringContaining('{{accountCount}}'),
        variables: expect.arrayContaining([
          expect.objectContaining({ key: 'userEmail' }),
          expect.objectContaining({ key: 'accountEmails' }),
        ]),
      }),
    ]);
  });

  it('saves customized content and rejects unsupported variables', async () => {
    const service = createService();
    await expect(service.update(actor, OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE, {
      subject: '  新增 {{accountCount}} 个账号  ',
      body: '账号列表：\n{{accountEmails}}',
    })).resolves.toMatchObject({
      customized: true,
      subject: '新增 {{accountCount}} 个账号',
      body: '账号列表：\n{{accountEmails}}',
    });
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'email-template.update',
      targetId: OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE,
    }));
    expect(mail.assertSelectable).toHaveBeenCalledWith(undefined);

    await expect(service.update(actor, OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE, {
      subject: '通知 {{unknownValue}}',
      body: '内容',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renders customized account binding notifications with recipient-specific values', async () => {
    templates.findOne.mockResolvedValue({
      code: OFFICIAL_ACCOUNT_BOUND_TEMPLATE_CODE,
      mailServiceId: '10000000-0000-4000-8000-000000000001',
      subject: '{{userEmail}} 获得 {{accountCount}} 个账号',
      body: '账号：\n{{accountEmails}}\n操作人：{{operatorEmail}}\n时间：{{boundAt}}',
    });
    const service = createService();

    await service.sendOfficialAccountBound({
      recipientEmail: 'User@Example.com',
      accountEmails: ['first@example.com', 'second@example.com'],
      operatorEmail: actor.email,
      boundAt: new Date('2026-07-22T02:30:00.000Z'),
    });

    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: '10000000-0000-4000-8000-000000000001',
      to: 'user@example.com',
      subject: 'User@Example.com 获得 2 个账号',
      text: expect.stringContaining('- first@example.com\n- second@example.com'),
      html: expect.stringContaining('- first@example.com<br>- second@example.com'),
    }));
  });

  it('reports a missing SMTP configuration when a notification is triggered', async () => {
    mail.send.mockRejectedValue(new ServiceUnavailableException('not configured'));
    const service = createService();

    await expect(service.sendOfficialAccountBound({
      recipientEmail: 'user@example.com',
      accountEmails: ['first@example.com'],
      operatorEmail: actor.email,
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
