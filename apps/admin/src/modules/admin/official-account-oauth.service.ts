import { randomBytes } from 'crypto';
import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';
import type { SystemAccountDto } from '@/modules/sync/sync.service';
import { AdminService } from './admin.service';

const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_ISSUER = 'https://auth.openai.com';
const ORIGINATOR = 'codex_cli_rs';
const SESSION_TTL_SECONDS = 15 * 60;
const RESULT_TTL_SECONDS = 5 * 60;

type OAuthSessionStatus = 'pending' | 'complete' | 'failed';

interface OAuthSession {
  ownerId: string;
  deviceAuthId: string;
  userCode: string;
  interval: number;
  expiresAt: number;
  status: OAuthSessionStatus;
  account?: SystemAccountDto;
  message?: string;
}

interface DeviceCodeResponse {
  device_auth_id?: unknown;
  user_code?: unknown;
  usercode?: unknown;
  interval?: unknown;
}

interface DeviceTokenResponse {
  authorization_code?: unknown;
  code_verifier?: unknown;
}

interface TokenResponse {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
}

@Injectable()
export class OfficialAccountOAuthService {
  private readonly clientId: string;
  private readonly issuer: string;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly admin: AdminService,
  ) {
    this.clientId = config.CODEX_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
    this.issuer = (config.CODEX_OAUTH_ISSUER?.trim() || DEFAULT_ISSUER).replace(/\/+$/, '');
  }

  async start(actor: AuthUser) {
    const response = await this.request(`${this.issuer}/api/accounts/deviceauth/usercode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId }),
    });
    if (!response.ok) {
      const message = response.status === 404
        ? 'Codex device authorization is not enabled for this OAuth server'
        : `Unable to start Codex OAuth (HTTP ${response.status})`;
      throw new BadGatewayException(message);
    }

    const payload = await this.json<DeviceCodeResponse>(response, 'Codex OAuth start response');
    const deviceAuthId = this.requiredString(payload.device_auth_id, 'device_auth_id');
    const userCode = this.requiredString(payload.user_code ?? payload.usercode, 'user_code');
    const interval = this.pollInterval(payload.interval);
    const sessionId = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    const session: OAuthSession = {
      ownerId: actor.id,
      deviceAuthId,
      userCode,
      interval,
      expiresAt,
      status: 'pending',
    };
    await this.redis.set(
      this.sessionKey(sessionId),
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SECONDS,
    );

    return {
      sessionId,
      verificationUrl: `${this.issuer}/codex/device`,
      userCode,
      interval,
      expiresIn: SESSION_TTL_SECONDS,
    };
  }

  async poll(actor: AuthUser, sessionId: string) {
    const key = this.sessionKey(sessionId);
    const session = await this.loadSession(key);
    if (session.ownerId !== actor.id) {
      throw new ForbiddenException('OAuth session belongs to another administrator');
    }
    if (session.status === 'complete') {
      return { status: session.status, account: session.account };
    }
    if (session.status === 'failed') {
      return { status: session.status, message: session.message };
    }
    if (session.expiresAt <= Date.now()) {
      await this.redis.del(key);
      throw new NotFoundException('OAuth session expired');
    }

    const lockKey = `${key}:lock`;
    const lock = await this.redis.set(lockKey, '1', 'EX', 60, 'NX');
    if (lock !== 'OK') return { status: 'pending' as const };

    try {
      const authorization = await this.pollDeviceAuthorization(session);
      if (!authorization) return { status: 'pending' as const };

      const tokens = await this.exchangeCode(
        this.requiredString(authorization.authorization_code, 'authorization_code'),
        this.requiredString(authorization.code_verifier, 'code_verifier'),
      );
      const idToken = this.requiredString(tokens.id_token, 'id_token');
      const accessToken = this.requiredString(tokens.access_token, 'access_token');
      const refreshToken = this.requiredString(tokens.refresh_token, 'refresh_token');
      const accountId = this.accountId(idToken);
      const auth: Record<string, unknown> = {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: idToken,
          access_token: accessToken,
          refresh_token: refreshToken,
          account_id: accountId,
        },
      };
      const account = await this.admin.createSystemAccount(actor, { auth });
      await this.saveResult(key, {
        ...session,
        status: 'complete',
        account,
      });
      return { status: 'complete' as const, account };
    } catch (error) {
      const message = this.errorMessage(error);
      await this.saveResult(key, { ...session, status: 'failed', message });
      return { status: 'failed' as const, message };
    } finally {
      await this.redis.del(lockKey);
    }
  }

  private async pollDeviceAuthorization(session: OAuthSession) {
    const response = await this.request(`${this.issuer}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: session.deviceAuthId,
        user_code: session.userCode,
      }),
    });
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) {
      throw new BadGatewayException(`Codex OAuth authorization failed (HTTP ${response.status})`);
    }
    return this.json<DeviceTokenResponse>(response, 'Codex OAuth authorization response');
  }

  private async exchangeCode(code: string, verifier: string) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${this.issuer}/deviceauth/callback`,
      client_id: this.clientId,
      code_verifier: verifier,
    });
    const response = await this.request(`${this.issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new BadGatewayException(`Codex OAuth token exchange failed (HTTP ${response.status})`);
    }
    return this.json<TokenResponse>(response, 'Codex OAuth token response');
  }

  private async request(url: string, init: RequestInit) {
    try {
      const headers = new Headers(init.headers);
      headers.set('originator', ORIGINATOR);
      headers.set('User-Agent', 'codex_cli_rs/0.1.0');
      return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new BadGatewayException('Unable to reach the Codex OAuth service');
    }
  }

  private async json<T>(response: Response, context: string): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new BadGatewayException(`${context} is not valid JSON`);
    }
  }

  private async loadSession(key: string): Promise<OAuthSession> {
    const raw = await this.redis.get(key);
    if (!raw) throw new NotFoundException('OAuth session not found or expired');
    try {
      return JSON.parse(raw) as OAuthSession;
    } catch {
      await this.redis.del(key);
      throw new NotFoundException('OAuth session is invalid');
    }
  }

  private saveResult(key: string, session: OAuthSession) {
    return this.redis.set(key, JSON.stringify(session), 'EX', RESULT_TTL_SECONDS);
  }

  private sessionKey(sessionId: string) {
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(sessionId)) {
      throw new NotFoundException('OAuth session not found or expired');
    }
    return `admin:official-account-oauth:${sessionId}`;
  }

  private pollInterval(value: unknown) {
    const parsed = Number(typeof value === 'string' ? value.trim() : value);
    if (!Number.isFinite(parsed)) return 5;
    return Math.min(15, Math.max(1, Math.ceil(parsed)));
  }

  private requiredString(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadGatewayException(`Codex OAuth response is missing ${field}`);
    }
    return value;
  }

  private accountId(idToken: string) {
    try {
      const payload = idToken.split('.')[1];
      if (!payload) return null;
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        'https://api.openai.com/auth'?: { chatgpt_account_id?: unknown };
      };
      const value = claims['https://api.openai.com/auth']?.chatgpt_account_id;
      return typeof value === 'string' && value ? value : null;
    } catch {
      return null;
    }
  }

  private errorMessage(error: unknown) {
    if (error instanceof HttpException) return error.message;
    return 'Codex OAuth authorization failed';
  }
}
