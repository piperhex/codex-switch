import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { DataSource, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/modules/auth/auth.service';
import type { AdminService } from '@/modules/admin/admin.service';
import type { RefreshTokenEntity } from '@/modules/auth/entities/refresh-token.entity';
import type { UserService } from '@/modules/user/user.service';
import type { EmailVerificationService } from '@/modules/auth/email-verification.service';
import type { RbacService } from '@/modules/rbac/rbac.service';
import { makeUser } from './fixtures';
import { Permission, USER_ROLE_PERMISSIONS } from '@/common/rbac/permissions';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('AuthService', () => {
  let users: {
    createUser: ReturnType<typeof vi.fn>;
    findByEmailWithPassword: ReturnType<typeof vi.fn>;
    validatePassword: ReturnType<typeof vi.fn>;
    markLogin: ReturnType<typeof vi.fn>;
    findActiveById: ReturnType<typeof vi.fn>;
    findActiveByEmail: ReturnType<typeof vi.fn>;
    emailExists: ReturnType<typeof vi.fn>;
    setPassword: ReturnType<typeof vi.fn>;
  };
  let jwt: { signAsync: ReturnType<typeof vi.fn>; verifyAsync: ReturnType<typeof vi.fn> };
  let admin: {
    validateInvitation: ReturnType<typeof vi.fn>;
    acceptInvitation: ReturnType<typeof vi.fn>;
  };
  let tokens: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let dataSource: { transaction: ReturnType<typeof vi.fn> };
  let transactionManager: object;
  let emailVerification: {
    sendRegistrationCode: ReturnType<typeof vi.fn>;
    sendPasswordResetCode: ReturnType<typeof vi.fn>;
    verifyAndConsume: ReturnType<typeof vi.fn>;
    verifyPasswordResetCode: ReturnType<typeof vi.fn>;
  };
  let rbac: { accessForRole: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'));
    users = {
      createUser: vi.fn(), findByEmailWithPassword: vi.fn(), validatePassword: vi.fn(),
      markLogin: vi.fn(), findActiveById: vi.fn(), findActiveByEmail: vi.fn(),
      emailExists: vi.fn(), setPassword: vi.fn(),
    };
    admin = {
      validateInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    jwt = { signAsync: vi.fn(), verifyAsync: vi.fn() };
    tokens = {
      create: vi.fn((value) => ({ id: 'refresh-id', ...value })),
      save: vi.fn(async (value) => value), findOne: vi.fn(), update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    transactionManager = { getRepository: vi.fn(() => tokens) };
    dataSource = {
      transaction: vi.fn(async (callback) => callback(transactionManager)),
    };
    emailVerification = {
      sendRegistrationCode: vi.fn().mockResolvedValue({ ok: true, expiresInSeconds: 300 }),
      sendPasswordResetCode: vi.fn().mockResolvedValue({ ok: true, expiresInSeconds: 300 }),
      verifyAndConsume: vi.fn().mockResolvedValue(undefined),
      verifyPasswordResetCode: vi.fn().mockResolvedValue(undefined),
    };
    rbac = {
      accessForRole: vi.fn(async (role: string) => ({
        roleName: role === 'admin' ? 'Administrator' : 'User',
        permissions: role === 'admin' ? Object.values(Permission) : [...USER_ROLE_PERMISSIONS],
      })),
    };
    service = new AuthService(
      users as unknown as UserService,
      admin as unknown as AdminService,
      jwt as unknown as JwtService,
      tokens as unknown as Repository<RefreshTokenEntity>,
      dataSource as unknown as DataSource,
      emailVerification as unknown as EmailVerificationService,
      rbac as unknown as RbacService,
      {
        KONG_JWT_KEY: 'kong-key',
        KONG_JWT_SECRET: 'kong-secret',
        JWT_ACCESS_EXPIRES: '5m',
        JWT_REFRESH_SECRET: 'refresh-secret',
        REFRESH_TOKEN_TTL_SECONDS: '120',
      },
    );
  });

  afterEach(() => vi.useRealTimers());

  function prepareIssuance() {
    jwt.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');
  }

  it('sends registration codes only for unregistered email addresses', async () => {
    users.emailExists.mockResolvedValue(false);
    await expect(service.requestRegistrationCode('new@example.com')).resolves.toEqual({
      ok: true, expiresInSeconds: 300,
    });
    expect(emailVerification.sendRegistrationCode).toHaveBeenCalledWith('new@example.com');

    users.emailExists.mockResolvedValue(true);
    await expect(service.requestRegistrationCode('existing@example.com'))
      .rejects.toThrow('Email is already registered');
  });

  it('sends password reset codes without revealing whether an account exists', async () => {
    users.findActiveByEmail.mockResolvedValueOnce(makeUser()).mockResolvedValueOnce(null);

    await expect(service.requestPasswordResetCode('user@example.com')).resolves.toEqual({
      ok: true, expiresInSeconds: 300,
    });
    await expect(service.requestPasswordResetCode('missing@example.com')).resolves.toEqual({
      ok: true, expiresInSeconds: 300,
    });

    expect(emailVerification.sendPasswordResetCode).toHaveBeenCalledTimes(1);
    expect(emailVerification.sendPasswordResetCode).toHaveBeenCalledWith('user@example.com');
  });

  it('resets a verified password and revokes every active refresh token', async () => {
    const user = makeUser();
    users.findActiveByEmail.mockResolvedValue(user);

    await expect(service.resetPassword(user.email, '123456', 'new-password'))
      .resolves.toEqual({ ok: true });

    expect(emailVerification.verifyPasswordResetCode).toHaveBeenCalledWith(user.email, '123456');
    expect(users.setPassword).toHaveBeenCalledWith(user, 'new-password', transactionManager);
    expect(tokens.update).toHaveBeenCalledWith(
      { userId: user.id, revokedAt: expect.anything() },
      { revokedAt: new Date('2026-07-04T00:00:00.000Z') },
    );
  });

  it('rejects password resets for unavailable users', async () => {
    users.findActiveByEmail.mockResolvedValue(null);
    await expect(service.resetPassword('missing@example.com', '123456', 'new-password'))
      .rejects.toThrow('Verification code is invalid or expired');
    expect(emailVerification.verifyPasswordResetCode).not.toHaveBeenCalled();
    expect(users.setPassword).not.toHaveBeenCalled();
  });

  it('registers a user and issues persistently hashed access/refresh tokens', async () => {
    const user = makeUser();
    users.createUser.mockResolvedValue(user);
    prepareIssuance();

    await expect(service.register('USER@example.com', 'password', '123456'))
      .resolves.toEqual({
        accessToken: 'access-token', refreshToken: 'refresh-token',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          roleName: 'User',
          permissions: [...USER_ROLE_PERMISSIONS],
        },
      });

    expect(users.createUser).toHaveBeenCalledWith({ email: 'USER@example.com', password: 'password' });
    expect(emailVerification.verifyAndConsume).toHaveBeenCalledWith('USER@example.com', '123456');
    expect(jwt.signAsync).toHaveBeenNthCalledWith(1, {
      sub: user.id, email: user.email, role: user.role, iss: 'kong-key',
    }, { secret: 'kong-secret', expiresIn: '5m' });
    expect(tokens.create).toHaveBeenCalledWith({
      userId: user.id, expiresAt: new Date('2026-07-04T00:02:00.000Z'),
    });
    expect(jwt.signAsync).toHaveBeenNthCalledWith(2, {
      sub: user.id, tokenId: 'refresh-id', typ: 'refresh',
    }, { secret: 'refresh-secret', expiresIn: 120 });
    expect(tokens.save).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: hash('refresh-token') }));
    expect(tokens.save.mock.calls[0][0].tokenHash).not.toBe('refresh-token');
  });

  it('registers with an invitation role and marks the invitation accepted', async () => {
    const user = makeUser({ role: 'admin' });
    admin.validateInvitation.mockResolvedValue({
      id: 'invitation-1', email: user.email, role: 'admin',
    });
    users.createUser.mockResolvedValue(user);
    prepareIssuance();

    await service.register(user.email, 'password', '123456', 'invite-token');

    expect(users.createUser).toHaveBeenCalledWith({
      email: user.email, password: 'password', role: 'admin',
    }, transactionManager);
    expect(admin.validateInvitation).toHaveBeenCalledWith(
      'invite-token', user.email, transactionManager,
    );
    expect(admin.acceptInvitation).toHaveBeenCalledWith('invitation-1', user, transactionManager);
  });

  it.each([
    ['unknown user', null, false],
    ['disabled user', makeUser({ disabled: true }), false],
    ['wrong password', makeUser(), false],
  ])('rejects login for %s', async (_, user, validPassword) => {
    users.findByEmailWithPassword.mockResolvedValue(user);
    users.validatePassword.mockResolvedValue(validPassword);
    await expect(service.login('user@example.com', 'wrong'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.markLogin).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('marks a successful login before issuing tokens', async () => {
    const user = makeUser();
    users.findByEmailWithPassword.mockResolvedValue(user);
    users.validatePassword.mockResolvedValue(true);
    prepareIssuance();
    await service.login(user.email, 'correct-password');
    expect(users.validatePassword).toHaveBeenCalledWith(user, 'correct-password');
    expect(users.markLogin).toHaveBeenCalledWith(user.id);
    expect(users.markLogin.mock.invocationCallOrder[0]).toBeLessThan(jwt.signAsync.mock.invocationCallOrder[0]);
  });

  it('maps verification failures and wrong token types to unauthorized', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad signature'));
    await expect(service.refresh('bad-token')).rejects.toThrow('Refresh token is invalid');

    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'user-1', tokenId: 'token-1', typ: 'access' });
    await expect(service.refresh('access-token')).rejects.toThrow('Refresh token is invalid');
    expect(tokens.findOne).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh token by atomically revoking the old record', async () => {
    const user = makeUser();
    const oldToken = {
      id: 'old-token-id', userId: user.id, user, tokenHash: hash('old-refresh'),
      expiresAt: new Date('2026-07-04T00:01:00.000Z'), revokedAt: null,
    };
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, tokenId: oldToken.id, typ: 'refresh' });
    tokens.findOne.mockResolvedValue(oldToken);
    prepareIssuance();

    await expect(service.refresh('old-refresh')).resolves.toMatchObject({ accessToken: 'access-token' });

    expect(jwt.verifyAsync).toHaveBeenCalledWith('old-refresh', { secret: 'refresh-secret' });
    expect(tokens.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: oldToken.id, userId: user.id, tokenHash: hash('old-refresh'), revokedAt: expect.anything(),
      }),
      relations: { user: true },
    });
    expect(tokens.update).toHaveBeenCalledWith(expect.objectContaining({
      id: oldToken.id,
      userId: user.id,
      tokenHash: hash('old-refresh'),
      revokedAt: expect.anything(),
      expiresAt: expect.anything(),
    }), { revokedAt: new Date('2026-07-04T00:00:00.000Z') });
  });

  it('rejects a refresh token already consumed by a concurrent request', async () => {
    const user = makeUser();
    const oldToken = {
      id: 'old-token-id', userId: user.id, user, tokenHash: hash('old-refresh'),
      expiresAt: new Date('2026-07-04T00:01:00.000Z'), revokedAt: null,
    };
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, tokenId: oldToken.id, typ: 'refresh' });
    tokens.findOne.mockResolvedValue(oldToken);
    tokens.update.mockResolvedValue({ affected: 0 });

    await expect(service.refresh('old-refresh')).rejects.toThrow('Refresh token expired');

    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['missing record', null],
    ['expired record', { expiresAt: new Date('2026-07-04T00:00:00.000Z'), user: makeUser() }],
    ['disabled owner', { expiresAt: new Date('2026-07-04T00:01:00.000Z'), user: makeUser({ disabled: true }) }],
  ])('rejects refresh for %s', async (_, token) => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', tokenId: 'token-1', typ: 'refresh' });
    tokens.findOne.mockResolvedValue(token);
    await expect(service.refresh('refresh')).rejects.toThrow('Refresh token expired');
    expect(tokens.save).not.toHaveBeenCalled();
  });

  it('revokes matching live tokens on logout without exposing storage details', async () => {
    await expect(service.logout('logout-token')).resolves.toEqual({ ok: true });
    expect(tokens.update).toHaveBeenCalledWith(
      { tokenHash: hash('logout-token'), revokedAt: expect.anything() },
      { revokedAt: new Date('2026-07-04T00:00:00.000Z') },
    );
  });

  it('returns only the public profile for an active user', async () => {
    const user = makeUser({ role: 'admin' });
    users.findActiveById.mockResolvedValue(user);
    await expect(service.me(user.id)).resolves.toEqual({
      id: user.id,
      email: user.email,
      role: 'admin',
      roleName: 'Administrator',
      permissions: Object.values(Permission),
    });
  });

  it('rejects profile lookup when the user is unavailable', async () => {
    users.findActiveById.mockResolvedValue(null);
    await expect(service.me('missing')).rejects.toThrow('User not found');
  });

  it('uses documented token defaults when optional settings are absent', async () => {
    const user = makeUser();
    service = new AuthService(
      users as unknown as UserService,
      admin as unknown as AdminService,
      jwt as unknown as JwtService,
      tokens as unknown as Repository<RefreshTokenEntity>,
      dataSource as unknown as DataSource,
      emailVerification as unknown as EmailVerificationService,
      rbac as unknown as RbacService,
      {},
    );
    users.createUser.mockResolvedValue(user);
    prepareIssuance();
    await service.register(user.email, 'password', '123456');
    expect(jwt.signAsync).toHaveBeenNthCalledWith(1, expect.objectContaining({ iss: 'codex-switch' }), {
      secret: 'change-me-kong-jwt-secret', expiresIn: '15m',
    });
    expect(jwt.signAsync).toHaveBeenNthCalledWith(2, expect.any(Object), {
      secret: 'replace-with-refresh-secret', expiresIn: 2_592_000,
    });
  });
});
