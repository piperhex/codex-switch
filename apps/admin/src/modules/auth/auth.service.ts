import { createHash } from 'crypto';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import { getKongJwtSecret, getRefreshSecret } from '@/config/auth-secrets';
import type { ConfigModuleOptions } from '@/config/config.types';
import { AdminService } from '@/modules/admin/admin.service';
import { RbacService } from '@/modules/rbac/rbac.service';
import { UserService } from '@/modules/user/user.service';
import { UserEntity } from '@/modules/user/entities/user.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import {
  EmailVerificationService,
  REGISTRATION_CODE_TTL_SECONDS,
} from './email-verification.service';

interface RefreshPayload {
  sub: string;
  tokenId: string;
  typ: 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly admin: AdminService,
    private readonly jwt: JwtService,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokens: Repository<RefreshTokenEntity>,
    private readonly dataSource: DataSource,
    private readonly emailVerification: EmailVerificationService,
    private readonly rbac: RbacService,
    @Inject(MODULE_OPTIONS_TOKEN)
    private readonly config: ConfigModuleOptions,
  ) {}

  async requestRegistrationCode(email: string) {
    if (await this.users.emailExists(email)) {
      throw new BadRequestException('Email is already registered');
    }
    return this.emailVerification.sendRegistrationCode(email);
  }

  async requestPasswordResetCode(email: string) {
    const user = await this.users.findActiveByEmail(email);
    if (user) await this.emailVerification.sendPasswordResetCode(email);
    return { ok: true, expiresInSeconds: REGISTRATION_CODE_TTL_SECONDS };
  }

  async resetPassword(email: string, verificationCode: string, newPassword: string) {
    const user = await this.users.findActiveByEmail(email);
    if (!user) throw new BadRequestException('Verification code is invalid or expired');
    await this.emailVerification.verifyPasswordResetCode(email, verificationCode);
    await this.dataSource.transaction(async (manager) => {
      await this.users.setPassword(user, newPassword, manager);
      await manager.getRepository(RefreshTokenEntity).update(
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });
    return { ok: true };
  }

  async register(email: string, password: string, verificationCode: string, inviteToken?: string) {
    await this.emailVerification.verifyAndConsume(email, verificationCode);
    const user = inviteToken
      ? await this.dataSource.transaction(async (manager) => {
        const invitation = await this.admin.validateInvitation(inviteToken, email, manager);
        const invitedUser = await this.users.createUser(
          { email, password, role: invitation.role },
          manager,
        );
        await this.admin.acceptInvitation(invitation.id, invitedUser, manager);
        return invitedUser;
      })
      : await this.users.createUser({ email, password });
    return this.issueTokens(user);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user || user.disabled || !(await this.users.validatePassword(user, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.users.markLogin(user.id);
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Refresh token is invalid');
    const token = await this.refreshTokens.findOne({
      where: {
        id: payload.tokenId,
        userId: payload.sub,
        tokenHash: this.hashToken(refreshToken),
        revokedAt: IsNull(),
      },
      relations: { user: true },
    });
    const now = new Date();
    if (!token || token.expiresAt <= now || token.user.disabled) {
      throw new UnauthorizedException('Refresh token expired');
    }
    const consumed = await this.refreshTokens.update(
      {
        id: payload.tokenId,
        userId: payload.sub,
        tokenHash: this.hashToken(refreshToken),
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
      { revokedAt: now },
    );
    if (consumed.affected !== 1) {
      throw new UnauthorizedException('Refresh token expired');
    }
    return this.issueTokens(token.user);
  }

  async logout(refreshToken: string) {
    await this.refreshTokens.update(
      { tokenHash: this.hashToken(refreshToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.users.findActiveById(userId);
    if (!user) throw new UnauthorizedException('User not found');
    const access = await this.rbac.accessForRole(user.role);
    if (!access) throw new UnauthorizedException('User role is no longer available');
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      roleName: access.roleName,
      permissions: access.permissions,
    };
  }

  private async issueTokens(user: UserEntity) {
    const access = await this.rbac.accessForRole(user.role);
    if (!access) throw new UnauthorizedException('User role is no longer available');
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        iss: this.config.KONG_JWT_KEY ?? 'codex-switch',
      },
      {
        secret: getKongJwtSecret(this.config),
        expiresIn: (this.config.JWT_ACCESS_EXPIRES ?? '15m') as JwtSignOptions['expiresIn'],
      },
    );
    const tokenEntity = this.refreshTokens.create({
      userId: user.id,
      expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, tokenId: tokenEntity.id, typ: 'refresh' },
      { secret: this.refreshSecret, expiresIn: this.refreshTtlSeconds },
    );
    tokenEntity.tokenHash = this.hashToken(refreshToken);
    await this.refreshTokens.save(tokenEntity);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        roleName: access.roleName,
        permissions: access.permissions,
      },
    };
  }

  private get refreshSecret() {
    return getRefreshSecret(this.config);
  }

  private get refreshTtlSeconds() {
    return Number(this.config.REFRESH_TOKEN_TTL_SECONDS ?? 30 * 24 * 60 * 60);
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
