import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type { MailServiceEntity } from '@/modules/mail/entities/mail-service.entity';
import { MailService } from '@/modules/mail/mail.service';

const sendMail = vi.hoisted(() => vi.fn());
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail })));

vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

describe('MailService', () => {
  const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
  const config = {
    KONG_JWT_SECRET: 'strong-mail-encryption-root',
    mail__transport: 'SMTP',
    mail__options__host: 'smtp.default.example.com',
    mail__options__port: '465',
    mail__options__secure: 'true',
    mail__options__auth__user: 'default@example.com',
    mail__options__auth__pass: 'default-secret',
    mail__from: 'Default <default@example.com>',
  };
  let services: {
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let auditLogs: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let customService: MailServiceEntity | null;

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: 'message-1' });
    createTransport.mockClear();
    customService = null;
    const builder = {
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => customService),
    };
    services = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => ({ id: 'mail-1', ...value })),
      save: vi.fn(async (value) => ({
        ...value,
        createdAt: new Date('2026-07-22T03:00:00.000Z'),
        updatedAt: new Date('2026-07-22T03:00:00.000Z'),
      })),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: vi.fn(() => builder),
    };
    auditLogs = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
    };
  });

  function createService() {
    return new MailService(
      services as unknown as Repository<MailServiceEntity>,
      auditLogs as unknown as Repository<AdminAuditLogEntity>,
      config,
    );
  }

  it('exposes the environment SMTP service as a read-only default', async () => {
    const result = await createService().list();

    expect(result[0]).toEqual(expect.objectContaining({
      id: null,
      source: 'default',
      host: config.mail__options__host,
      enabled: true,
      hasPassword: true,
    }));
    expect(result[0]).not.toHaveProperty('password');
  });

  it('encrypts custom SMTP passwords and never returns them', async () => {
    const service = createService();
    const result = await service.create(actor, {
      name: 'Transactional SMTP',
      host: 'smtp.custom.example.com',
      port: 587,
      secure: false,
      username: 'custom@example.com',
      password: 'custom-secret',
      fromAddress: 'Custom <custom@example.com>',
      enabled: true,
    });
    const stored = services.save.mock.calls[0][0] as MailServiceEntity;

    expect(stored.encryptedPassword).toMatch(/^v1:/);
    expect(stored.encryptedPassword).not.toContain('custom-secret');
    expect(result).not.toHaveProperty('encryptedPassword');
    expect(result).not.toHaveProperty('password');
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mail-service.create',
      targetId: 'mail-1',
    }));
  });

  it('decrypts the selected custom service only while sending', async () => {
    const service = createService();
    await service.create(actor, {
      name: 'Transactional SMTP',
      host: 'smtp.custom.example.com',
      port: 587,
      secure: false,
      username: 'custom@example.com',
      password: 'custom-secret',
      fromAddress: 'Custom <custom@example.com>',
      enabled: true,
    });
    customService = services.save.mock.results[0].value
      ? await services.save.mock.results[0].value
      : null;

    await service.send({
      serviceId: 'mail-1',
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Message',
    });

    expect(createTransport).toHaveBeenLastCalledWith({
      host: 'smtp.custom.example.com',
      port: 587,
      secure: false,
      auth: { user: 'custom@example.com', pass: 'custom-secret' },
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Custom <custom@example.com>',
      to: 'user@example.com',
    }));
  });

  it('uses the default service when no custom service is selected', async () => {
    const service = createService();
    await service.send({ to: 'user@example.com', subject: 'Subject', text: 'Message' });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: config.mail__from,
      to: 'user@example.com',
    }));
  });
});
