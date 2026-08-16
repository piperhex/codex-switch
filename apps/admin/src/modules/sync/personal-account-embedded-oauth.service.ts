import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';
import {
  createCodexOutboundDispatcher,
  withCodexOutboundDispatcher,
} from './codex-outbound-proxy';
import { SyncService, type MobileSyncAccountDto } from './sync.service';

const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_ISSUER = 'https://auth.openai.com';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const ORIGINATOR = 'codex_cli_rs';
const SESSION_TTL_SECONDS = 10 * 60;
const RESULT_TTL_SECONDS = 5 * 60;
const OAUTH_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke';

type OAuthSessionStatus = 'pending' | 'complete' | 'failed';

interface OAuthSession {
  ownerId: string;
  verifier: string;
  state: string;
  expiresAt: number;
  status: OAuthSessionStatus;
  account?: MobileSyncAccountDto;
  message?: string;
}

interface OAuthCallback {
  code?: string;
  state: string;
  error?: string;
}

interface TokenResponse {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
}

@Injectable()
export class PersonalAccountEmbeddedOAuthService {
  private readonly clientId: string;
  private readonly issuer: string;
  private readonly dispatcher: ReturnType<typeof createCodexOutboundDispatcher>;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sync: SyncService,
  ) {
    this.clientId = config.CODEX_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
    this.issuer = (config.CODEX_OAUTH_ISSUER?.trim() || DEFAULT_ISSUER).replace(/\/+$/, '');
    this.dispatcher = createCodexOutboundDispatcher(config.CODEX_OUTBOUND_PROXY);
  }

  async start(actor: AuthUser) {
    const sessionId = this.randomValue(32);
    const verifier = this.randomValue(64);
    const state = this.randomValue(32);
    const session: OAuthSession = {
      ownerId: actor.id,
      verifier,
      state,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
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
      authorizationUrl: this.authorizationUrl(state, verifier),
      callbackUrl: REDIRECT_URI,
      expiresIn: SESSION_TTL_SECONDS,
    };
  }

  async complete(actor: AuthUser, sessionId: string, callback: OAuthCallback) {
    const key = this.sessionKey(sessionId);
    const session = await this.loadOwnedSession(key, actor);
    const terminal = this.terminalResult(session);
    if (terminal) return terminal;
    if (!this.valuesMatch(session.state, callback.state)) {
      throw new ForbiddenException('OAuth callback state is invalid');
    }
    if (callback.error) {
      return this.fail(key, session, this.callbackErrorMessage(callback.error));
    }
    if (!callback.code?.trim()) throw new BadRequestException('OAuth callback code is missing');

    const lockKey = `${key}:lock`;
    const lock = await this.redis.set(lockKey, '1', 'EX', 60, 'NX');
    if (lock !== 'OK') return { status: 'pending' as const };
    try {
      return await this.finish(key, session, callback.code);
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async poll(actor: AuthUser, sessionId: string) {
    const session = await this.loadOwnedSession(this.sessionKey(sessionId), actor);
    return this.terminalResult(session) ?? { status: 'pending' as const };
  }

  private authorizationUrl(state: string, verifier: string) {
    const url = new URL(`${this.issuer}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', OAUTH_SCOPE);
    url.searchParams.set('code_challenge', this.codeChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    url.searchParams.set('state', state);
    url.searchParams.set('originator', ORIGINATOR);
    return url.toString();
  }

  private async finish(key: string, session: OAuthSession, code: string) {
    try {
      const tokens = await this.exchangeCode(code, session.verifier);
      const account = await this.sync.upsertPersonalAccountFromAuth(
        session.ownerId,
        this.authFromTokens(tokens),
      );
      await this.saveResult(key, { ...session, status: 'complete', account });
      return { status: 'complete' as const, account };
    } catch (error) {
      return this.fail(key, session, this.errorMessage(error));
    }
  }

  private async exchangeCode(code: string, verifier: string) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
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
      const request = withCodexOutboundDispatcher({ ...init, headers }, this.dispatcher);
      return await fetch(url, { ...request, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new BadGatewayException('Unable to reach the Codex OAuth service');
    }
  }

  private async loadOwnedSession(key: string, actor: AuthUser) {
    const raw = await this.redis.get(key);
    if (!raw) throw new NotFoundException('OAuth session not found or expired');
    const session = this.parseSession(raw);
    if (session.ownerId !== actor.id) {
      throw new ForbiddenException('OAuth session belongs to another user');
    }
    if (session.expiresAt <= Date.now()) {
      await this.redis.del(key);
      throw new NotFoundException('OAuth session expired');
    }
    return session;
  }

  private parseSession(raw: string): OAuthSession {
    try {
      return JSON.parse(raw) as OAuthSession;
    } catch {
      throw new NotFoundException('OAuth session is invalid');
    }
  }

  private terminalResult(session: OAuthSession) {
    if (session.status === 'complete') {
      return { status: session.status, account: session.account };
    }
    if (session.status === 'failed') {
      return { status: session.status, message: session.message };
    }
    return null;
  }

  private fail(key: string, session: OAuthSession, message: string) {
    const failed = { ...session, status: 'failed' as const, message };
    return this.saveResult(key, failed).then(() => ({ status: failed.status, message }));
  }

  private saveResult(key: string, session: OAuthSession) {
    return this.redis.set(key, JSON.stringify(session), 'EX', RESULT_TTL_SECONDS);
  }

  private authFromTokens(tokens: TokenResponse) {
    const idToken = this.requiredString(tokens.id_token, 'id_token');
    return {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: idToken,
        access_token: this.requiredString(tokens.access_token, 'access_token'),
        refresh_token: this.requiredString(tokens.refresh_token, 'refresh_token'),
        account_id: this.accountId(idToken),
      },
    };
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

  private async json<T>(response: Response, context: string): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new BadGatewayException(`${context} is not valid JSON`);
    }
  }

  private requiredString(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadGatewayException(`Codex OAuth response is missing ${field}`);
    }
    return value;
  }

  private sessionKey(sessionId: string) {
    if (!/^[A-Za-z0-9_-]{40,90}$/.test(sessionId)) {
      throw new NotFoundException('OAuth session not found or expired');
    }
    return `sync:personal-account-embedded-oauth:${sessionId}`;
  }

  private codeChallenge(verifier: string) {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private randomValue(bytes: number) {
    return randomBytes(bytes).toString('base64url');
  }

  private valuesMatch(expected: string, actual: string) {
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(actual);
    return expectedBytes.length === actualBytes.length
      && timingSafeEqual(expectedBytes, actualBytes);
  }

  private callbackErrorMessage(error: string) {
    return error === 'access_denied'
      ? 'ChatGPT authorization was cancelled'
      : 'ChatGPT authorization failed';
  }

  private errorMessage(error: unknown) {
    return error instanceof HttpException ? error.message : 'ChatGPT authorization failed';
  }
}
