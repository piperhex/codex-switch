import { ForbiddenException } from '@nestjs/common';
import type Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { AdminService } from '@/modules/admin/admin.service';
import { OfficialAccountOAuthService } from '@/modules/admin/official-account-oauth.service';

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
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin',
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
  const account = {
    id: 'system-1',
    syncAccountId: 'sync-1',
    email: 'codex@example.com',
  };
  const admin = {
    createSystemAccount: vi.fn().mockResolvedValue(account),
  };
  const service = new OfficialAccountOAuthService(
    {},
    redis as unknown as Redis,
    admin as unknown as AdminService,
  );
  return { account, admin, redis, service };
}

async function startSession(service: OfficialAccountOAuthService, fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(jsonResponse({
    device_auth_id: 'device-auth-1',
    user_code: 'ABCD-EFGH',
    interval: '2',
  }));
  return service.start(actor);
}

describe('OfficialAccountOAuthService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a short-lived device authorization session without exposing its device id', async () => {
    const { redis, service } = setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await startSession(service, fetchMock);

    expect(result).toMatchObject({
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
      interval: 2,
      expiresIn: 900,
    });
    expect(result).not.toHaveProperty('deviceAuthId');
    expect(redis.values.get(`admin:official-account-oauth:${result.sessionId}`))
      .toContain('device-auth-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.openai.com/api/accounts/deviceauth/usercode',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps a pending session isolated to the administrator who started it', async () => {
    const { service } = setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const session = await startSession(service, fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(service.poll(actor, session.sessionId)).resolves.toEqual({ status: 'pending' });
    await expect(service.poll({ ...actor, id: 'admin-2' }, session.sessionId))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('exchanges an approved device code and records the account through AdminService', async () => {
    const { account, admin, service } = setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const session = await startSession(service, fetchMock);
    const idToken = jwt({
      email: 'codex@example.com',
      'https://api.openai.com/auth': { chatgpt_account_id: 'workspace-1' },
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        authorization_code: 'authorization-code',
        code_challenge: 'challenge',
        code_verifier: 'verifier',
      }))
      .mockResolvedValueOnce(jsonResponse({
        id_token: idToken,
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }));

    await expect(service.poll(actor, session.sessionId)).resolves.toEqual({
      status: 'complete',
      account,
    });
    expect(admin.createSystemAccount).toHaveBeenCalledWith(actor, {
      auth: {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: idToken,
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: 'workspace-1',
        },
      },
    });
    const exchangeRequest = fetchMock.mock.calls[2];
    expect(exchangeRequest[0]).toBe('https://auth.openai.com/oauth/token');
    expect(String(exchangeRequest[1].body)).toContain('redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback');

    await expect(service.poll(actor, session.sessionId)).resolves.toEqual({
      status: 'complete',
      account,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stores a safe terminal error when token exchange fails', async () => {
    const { admin, service } = setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const session = await startSession(service, fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        authorization_code: 'authorization-code',
        code_verifier: 'verifier',
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'secret provider detail' }, 401));

    await expect(service.poll(actor, session.sessionId)).resolves.toEqual({
      status: 'failed',
      message: 'Codex OAuth token exchange failed (HTTP 401)',
    });
    expect(admin.createSystemAccount).not.toHaveBeenCalled();
    await expect(service.poll(actor, session.sessionId)).resolves.toEqual({
      status: 'failed',
      message: 'Codex OAuth token exchange failed (HTTP 401)',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
