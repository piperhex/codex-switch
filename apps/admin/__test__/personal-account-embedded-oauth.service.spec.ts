import { ForbiddenException } from '@nestjs/common';
import type Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { PersonalAccountEmbeddedOAuthService } from '@/modules/sync/personal-account-embedded-oauth.service';
import type { SyncService } from '@/modules/sync/sync.service';

class FakeRedis {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>) {
    if (args.includes('NX') && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]) {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) deleted += 1;
    }
    return deleted;
  }
}

const actor: AuthUser = {
  id: 'owner-1',
  email: 'owner@example.com',
  role: 'user',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jwt(claims: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.');
}

function setup() {
  const redis = new FakeRedis();
  const account = { id: 'account-1', email: 'codex@example.com' };
  const sync = {
    upsertPersonalAccountFromAuth: vi.fn().mockResolvedValue(account),
  };
  const service = new PersonalAccountEmbeddedOAuthService(
    {},
    redis as unknown as Redis,
    sync as unknown as SyncService,
  );
  return { account, redis, service, sync };
}

describe('PersonalAccountEmbeddedOAuthService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a private PKCE authorization session without exposing the verifier', async () => {
    const { redis, service } = setup();

    const result = await service.start(actor);
    const authorizationUrl = new URL(result.authorizationUrl);

    expect(result.callbackUrl).toBe('http://localhost:1455/auth/callback');
    expect(result.expiresIn).toBe(600);
    expect(authorizationUrl.origin).toBe('https://auth.openai.com');
    expect(authorizationUrl.pathname).toBe('/oauth/authorize');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(result.callbackUrl);
    expect(authorizationUrl.searchParams.get('codex_cli_simplified_flow')).toBe('true');
    expect(result).not.toHaveProperty('verifier');
    expect(redis.values.get(`sync:personal-account-embedded-oauth:${result.sessionId}`))
      .toContain('verifier');
  });

  it('exchanges the intercepted callback and stores the personal account', async () => {
    const { account, service, sync } = setup();
    const session = await service.start(actor);
    const state = new URL(session.authorizationUrl).searchParams.get('state') ?? '';
    const idToken = jwt({
      email: 'codex@example.com',
      'https://api.openai.com/auth': { chatgpt_account_id: 'workspace-1' },
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id_token: idToken,
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.complete(actor, session.sessionId, {
      code: 'authorization-code', state,
    })).resolves.toEqual({ status: 'complete', account });
    await expect(service.poll(actor, session.sessionId))
      .resolves.toEqual({ status: 'complete', account });

    expect(sync.upsertPersonalAccountFromAuth).toHaveBeenCalledWith(actor.id, {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: idToken,
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'workspace-1',
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://auth.openai.com/oauth/token');
    const tokenBody = String((fetchMock.mock.calls[0]?.[1] as RequestInit).body);
    expect(tokenBody).toContain('code=authorization-code');
    expect(tokenBody).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback');
  });

  it('rejects callbacks with a mismatched security state', async () => {
    const { service, sync } = setup();
    const session = await service.start(actor);

    await expect(service.complete(actor, session.sessionId, {
      code: 'authorization-code', state: 'invalid-state',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(sync.upsertPersonalAccountFromAuth).not.toHaveBeenCalled();
  });

  it('records a user cancellation without contacting the token endpoint', async () => {
    const { service } = setup();
    const session = await service.start(actor);
    const state = new URL(session.authorizationUrl).searchParams.get('state') ?? '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.complete(actor, session.sessionId, {
      error: 'access_denied', state,
    })).resolves.toEqual({
      status: 'failed',
      message: 'ChatGPT authorization was cancelled',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
