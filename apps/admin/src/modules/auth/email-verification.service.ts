import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';
import nodemailer, { type Transporter } from 'nodemailer';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';

export const REGISTRATION_CODE_TTL_SECONDS = 5 * 60;
const REGISTRATION_CODE_RESEND_SECONDS = 60;
const REGISTRATION_CODE_MAX_ATTEMPTS = 5;

type VerificationPurpose = 'registration' | 'password-reset';

interface StoredRegistrationCode {
  salt: string;
  hash: string;
}

@Injectable()
export class EmailVerificationService {
  private readonly transporter?: Transporter;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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

  async sendRegistrationCode(email: string) {
    return this.sendCode(email, 'registration');
  }

  async sendPasswordResetCode(email: string) {
    return this.sendCode(email, 'password-reset');
  }

  async verifyAndConsume(email: string, code: string) {
    return this.verifyCodeAndConsume(email, code, 'registration');
  }

  async verifyPasswordResetCode(email: string, code: string) {
    return this.verifyCodeAndConsume(email, code, 'password-reset');
  }

  private async sendCode(email: string, purpose: VerificationPurpose) {
    this.ensureConfigured();
    const normalizedEmail = this.normalizeEmail(email);
    const cooldownKey = this.cooldownKey(normalizedEmail, purpose);
    const cooldown = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      REGISTRATION_CODE_RESEND_SECONDS,
      'NX',
    );
    if (cooldown !== 'OK') {
      throw new HttpException(
        'Please wait before requesting another verification code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const stored: StoredRegistrationCode = { salt, hash: this.hash(normalizedEmail, code, salt) };
    const codeKey = this.codeKey(normalizedEmail, purpose);
    const attemptsKey = this.attemptsKey(normalizedEmail, purpose);
    await this.redis.del(attemptsKey);
    await this.redis.set(codeKey, JSON.stringify(stored), 'EX', REGISTRATION_CODE_TTL_SECONDS);

    try {
      await this.transporter!.sendMail({
        from: this.config.mail__from,
        to: normalizedEmail,
        subject: purpose === 'registration'
          ? 'Codex Switch 注册验证码'
          : 'Codex Switch 密码重置验证码',
        text: purpose === 'registration'
          ? `你的 Codex Switch 注册验证码是 ${code}，5 分钟内有效。请勿将验证码提供给他人。`
          : `你的 Codex Switch 密码重置验证码是 ${code}，5 分钟内有效。请勿将验证码提供给他人。`,
        html: purpose === 'registration'
          ? `<p>你的 Codex Switch 注册验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 5 分钟内有效，请勿将验证码提供给他人。</p>`
          : `<p>你的 Codex Switch 密码重置验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 5 分钟内有效，请勿将验证码提供给他人。</p>`,
      });
    } catch {
      await this.redis.del(codeKey, cooldownKey, attemptsKey);
      throw new ServiceUnavailableException('Verification email could not be sent');
    }

    return { ok: true, expiresInSeconds: REGISTRATION_CODE_TTL_SECONDS };
  }

  private async verifyCodeAndConsume(email: string, code: string, purpose: VerificationPurpose) {
    const normalizedEmail = this.normalizeEmail(email);
    const key = this.codeKey(normalizedEmail, purpose);
    const serialized = await this.redis.get(key);
    if (!serialized) throw this.invalidCode();

    let stored: StoredRegistrationCode;
    try {
      stored = JSON.parse(serialized) as StoredRegistrationCode;
    } catch {
      await this.redis.del(key);
      throw this.invalidCode();
    }

    const actual = Buffer.from(this.hash(normalizedEmail, code, stored.salt), 'hex');
    const expected = Buffer.from(stored.hash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await this.redis.eval(
        `local attempts = redis.call('INCR', KEYS[2])
         if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
         if attempts >= tonumber(ARGV[2]) then
           redis.call('DEL', KEYS[1], KEYS[2])
         end
         return attempts`,
        2,
        key,
        this.attemptsKey(normalizedEmail, purpose),
        REGISTRATION_CODE_TTL_SECONDS,
        REGISTRATION_CODE_MAX_ATTEMPTS,
      );
      throw this.invalidCode();
    }

    const consumed = await this.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
         redis.call('DEL', KEYS[1], KEYS[2])
         return 1
       end
       return 0`,
      2,
      key,
      this.attemptsKey(normalizedEmail, purpose),
      serialized,
    );
    if (consumed !== 1) throw this.invalidCode();
  }

  private ensureConfigured() {
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

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private codeKey(email: string, purpose: VerificationPurpose) {
    return `auth:${purpose}-code:${createHash('sha256').update(email).digest('hex')}`;
  }

  private cooldownKey(email: string, purpose: VerificationPurpose) {
    return `${this.codeKey(email, purpose)}:cooldown`;
  }

  private attemptsKey(email: string, purpose: VerificationPurpose) {
    return `${this.codeKey(email, purpose)}:attempts`;
  }

  private hash(email: string, code: string, salt: string) {
    return createHash('sha256').update(`${email}:${code}:${salt}`).digest('hex');
  }

  private boolean(value: string | undefined, fallback: boolean) {
    if (value === undefined) return fallback;
    return value.trim().toLowerCase() === 'true';
  }

  private invalidCode() {
    return new BadRequestException('Verification code is invalid or expired');
  }
}
