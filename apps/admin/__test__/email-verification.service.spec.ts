import { createHash } from 'node:crypto';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailVerificationService,
  REGISTRATION_CODE_TTL_SECONDS,
} from '@/modules/auth/email-verification.service';

const sendMail = vi.hoisted(() => vi.fn());

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail })),
  },
}));

describe('EmailVerificationService', () => {
  let redis: {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
  };

  const config = {
    mail__transport: 'SMTP',
    mail__options__host: 'smtp.mailgun.org',
    mail__options__port: '465',
    mail__options__secure: 'true',
    mail__options__auth__user: 'blog@chirp.onepiper.cloud',
    mail__options__auth__pass: 'mail-secret',
    mail__from: 'Codex Switch <noreply@blog.onepiper.cloud>',
  };

  beforeEach(() => {
    redis = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(1),
    };
    sendMail.mockReset().mockResolvedValue({ messageId: 'message-1' });
  });

  it('sends a six-digit registration code stored with a five-minute TTL', async () => {
    const service = new EmailVerificationService(redis as unknown as Redis, config);

    await expect(service.sendRegistrationCode(' User@Example.COM ')).resolves.toEqual({
      ok: true,
      expiresInSeconds: REGISTRATION_CODE_TTL_SECONDS,
    });

    expect(redis.set).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/:cooldown$/),
      '1',
      'EX',
      60,
      'NX',
    );
    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('auth:registration-code:'),
      expect.any(String),
      'EX',
      300,
    );
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: config.mail__from,
      to: 'user@example.com',
      subject: expect.stringContaining('验证码'),
      text: expect.stringMatching(/\b\d{6}\b/),
    }));
  });

  it('keeps password reset codes separate from registration codes', async () => {
    const service = new EmailVerificationService(redis as unknown as Redis, config);

    await expect(service.sendPasswordResetCode('user@example.com')).resolves.toEqual({
      ok: true,
      expiresInSeconds: REGISTRATION_CODE_TTL_SECONDS,
    });

    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('auth:password-reset-code:'),
      expect.any(String),
      'EX',
      300,
    );
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('密码重置验证码'),
    }));
  });

  it('atomically consumes a matching code and rejects a wrong code', async () => {
    const service = new EmailVerificationService(redis as unknown as Redis, config);
    const email = 'user@example.com';
    const code = '012345';
    const salt = 'salt';
    const serialized = JSON.stringify({
      salt,
      hash: createHash('sha256').update(`${email}:${code}:${salt}`).digest('hex'),
    });
    redis.get.mockResolvedValue(serialized);

    await expect(service.verifyAndConsume(email, code)).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String), 2, expect.any(String), expect.stringMatching(/:attempts$/), serialized,
    );

    redis.eval.mockClear();
    await expect(service.verifyAndConsume(email, '999999'))
      .rejects.toThrow('Verification code is invalid or expired');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String), 2, expect.any(String), expect.stringMatching(/:attempts$/), 300, 5,
    );

    redis.eval.mockClear().mockResolvedValue(1);
    await expect(service.verifyPasswordResetCode(email, code)).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.stringContaining('auth:password-reset-code:'),
      expect.stringMatching(/:attempts$/),
      serialized,
    );
  });

  it('enforces resend cooldown and requires complete SMTP configuration', async () => {
    redis.set.mockResolvedValueOnce(null);
    const service = new EmailVerificationService(redis as unknown as Redis, config);
    await expect(service.sendRegistrationCode('user@example.com')).rejects.toBeInstanceOf(HttpException);

    const unconfigured = new EmailVerificationService(redis as unknown as Redis, {});
    await expect(unconfigured.sendRegistrationCode('user@example.com'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
