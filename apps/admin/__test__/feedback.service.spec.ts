import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type { FeedbackAttachmentEntity } from '@/modules/feedback/entities/feedback-attachment.entity';
import type { FeedbackEntity } from '@/modules/feedback/entities/feedback.entity';
import {
  FeedbackService,
  MAX_FEEDBACK_IMAGE_BYTES,
  type UploadedFeedbackImage,
} from '@/modules/feedback/feedback.service';

function createService() {
  const feedback = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({
      ...value,
      id: 'feedback-1',
      createdAt: new Date('2026-07-18T10:00:00.000Z'),
    })),
    findAndCount: vi.fn(),
    findOne: vi.fn(),
  };
  const attachments = {
    create: vi.fn((value) => value),
    createQueryBuilder: vi.fn(),
  };
  const auditLogs = { create: vi.fn((value) => value), save: vi.fn() };
  const service = new FeedbackService(
    feedback as unknown as Repository<FeedbackEntity>,
    attachments as unknown as Repository<FeedbackAttachmentEntity>,
    auditLogs as unknown as Repository<AdminAuditLogEntity>,
    {},
  );
  return { service, feedback, attachments };
}

function jpeg(overrides: Partial<UploadedFeedbackImage> = {}): UploadedFeedbackImage {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  return {
    buffer,
    originalname: 'issue.jpg',
    mimetype: 'image/jpeg',
    size: buffer.length,
    ...overrides,
  };
}

describe('FeedbackService', () => {
  it('binds the authenticated email and persists validated image metadata', async () => {
    const { service, feedback, attachments } = createService();
    const actor: AuthUser = { id: 'user-1', email: 'user@example.com', role: 'user' };

    await expect(service.create({
      content: '  The switch button stopped responding  ',
      version: ' 1.0.5 ',
      platform: ' Windows 11 / x86_64 ',
    }, [jpeg()], actor)).resolves.toEqual({
      id: 'feedback-1',
      createdAt: '2026-07-18T10:00:00.000Z',
    });

    expect(attachments.create).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'issue.jpg',
      mimeType: 'image/jpeg',
      size: 4,
    }));
    expect(feedback.create).toHaveBeenCalledWith(expect.objectContaining({
      content: 'The switch button stopped responding',
      version: '1.0.5',
      platform: 'Windows 11 / x86_64',
      userId: actor.id,
      email: actor.email,
    }));
  });

  it('keeps anonymous feedback free of user identity', async () => {
    const { service, feedback } = createService();
    await service.create({ content: 'Issue', version: '1.0.5', platform: 'Linux' }, []);
    expect(feedback.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      email: null,
    }));
  });

  it('rejects oversized and forged image attachments', async () => {
    const { service } = createService();
    const dto = { content: 'Issue', version: '1.0.5', platform: 'Windows' };
    await expect(service.create(dto, [jpeg({ size: MAX_FEEDBACK_IMAGE_BYTES + 1 })]))
      .rejects.toThrow('Each feedback image must not exceed 5 MB');
    await expect(service.create(dto, [jpeg({ buffer: Buffer.from('not-an-image'), size: 12 })]))
      .rejects.toThrow('Feedback image data is invalid');
  });
});
