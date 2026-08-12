import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { AdminService } from '@/modules/admin/admin.service';
import {
  normalizeCompatibleAuth,
  normalizeSub2apiAuth,
  OfficialAccountImportService,
  parseCompatibleJsonAccounts,
  parseSub2apiJsonAccounts,
} from '@/modules/admin/official-account-import.service';

const actor: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin',
};

function jwt(claims: Record<string, unknown>) {
  return [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('OfficialAccountImportService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses single objects, arrays, accounts wrappers, BOM, and newline-delimited objects', () => {
    expect(parseCompatibleJsonAccounts('{"access_token":"one"}')).toHaveLength(1);
    expect(parseCompatibleJsonAccounts('[{"access_token":"one"},{"access_token":"two"}]'))
      .toHaveLength(2);
    expect(parseCompatibleJsonAccounts('{"accounts":[{"access_token":"one"}]}'))
      .toHaveLength(1);
    expect(parseCompatibleJsonAccounts('\uFEFF{"access_token":"one"}')).toHaveLength(1);
    expect(parseCompatibleJsonAccounts(
      '{"access_token":"one"}\n\n{"access_token":"two"}',
    )).toHaveLength(2);
    expect(() => parseCompatibleJsonAccounts('[]')).toThrow(BadRequestException);
  });

  it('normalizes common aliases and JSON-encoded session wrappers', () => {
    const token = jwt({ sub: 'compatible-user' });
    expect(normalizeCompatibleAuth({
      credentials: {
        idToken: token,
        accessToken: token,
        refreshToken: 'refresh-token',
      },
    })).toEqual({
      tokens: {
        id_token: token,
        access_token: token,
        refresh_token: 'refresh-token',
        chatgpt_user_id: 'compatible-user',
      },
    });
    expect(normalizeCompatibleAuth({
      session_json: JSON.stringify({ accessToken: token }),
    })).toEqual({ tokens: {
      access_token: token,
      chatgpt_user_id: 'compatible-user',
    } });
  });

  it('recursively finds wrapped accounts and preserves explicit opaque-token identity', () => {
    const [account] = parseCompatibleJsonAccounts(JSON.stringify({
      data: {
        items: [{
          session: {
            token: { accessToken: 'at-opaque-personal-access-token' },
            user: { id: 'user-1', email: 'person@example.com' },
            account: { id: 'workspace-1', planType: 'team' },
          },
        }],
      },
    }));

    expect(normalizeCompatibleAuth(account)).toEqual({
      tokens: {
        access_token: 'at-opaque-personal-access-token',
        account_id: 'workspace-1',
        chatgpt_user_id: 'user-1',
        email: 'person@example.com',
        plan_type: 'team',
      },
    });
  });

  it('accepts headerless sub2api account exports', () => {
    const [account] = parseSub2apiJsonAccounts(JSON.stringify({
      exported_at: '2026-08-12T06:34:28Z',
      proxies: [],
      accounts: [{
        name: 'person@example.com',
        platform: 'openai',
        type: 'oauth',
        credentials: {
          chatgpt_account_id: 'workspace-1',
          chatgpt_user_id: 'user-1',
          plan_type: 'team',
          access_token: 'at-opaque-personal-access-token',
          auth_mode: 'personalAccessToken',
          email: 'person@example.com',
        },
      }],
    }));

    expect(normalizeSub2apiAuth(account)).toMatchObject({
      tokens: {
        access_token: 'at-opaque-personal-access-token',
        account_id: 'workspace-1',
        chatgpt_user_id: 'user-1',
        email: 'person@example.com',
      },
    });
  });

  it('discards the AxonHub missing-refresh-token placeholder', () => {
    const token = jwt({ sub: 'axon-user' });
    expect(normalizeCompatibleAuth({
      access_token: token,
      refresh_token: '__missing_refresh_token__',
    })).toEqual({ tokens: { access_token: token, chatgpt_user_id: 'axon-user' } });
  });

  it('parses and normalizes sub2api Agent Identity exports', () => {
    const privateKey = Buffer.alloc(48, 7).toString('base64');
    const content = JSON.stringify({
      type: 'sub2api-data',
      version: 1,
      proxies: [],
      accounts: [{
        platform: 'openai',
        type: 'oauth',
        credentials: {
          auth_mode: 'agentIdentity',
          agent_runtime_id: 'agent-runtime',
          agent_private_key: privateKey,
          account_id: 'workspace-1',
          chatgpt_user_id: 'user-1',
          email: 'agent@example.com',
          plan_type: 'business',
        },
      }],
    });

    const values = parseSub2apiJsonAccounts(content);
    expect(values).toHaveLength(1);
    expect(normalizeSub2apiAuth(values[0])).toEqual({
      auth_mode: 'agentIdentity',
      agent_identity: {
        agent_runtime_id: 'agent-runtime',
        agent_private_key: privateKey,
        account_id: 'workspace-1',
        chatgpt_user_id: 'user-1',
        email: 'agent@example.com',
        plan_type: 'business',
        chatgpt_account_is_fedramp: false,
      },
    });
  });

  it('normalizes sub2api OAuth exports with opaque access tokens', () => {
    const content = JSON.stringify({
      type: 'sub2api-data',
      version: 1,
      exported_at: '2026-07-23T06:05:26Z',
      proxies: [],
      accounts: [{
        platform: 'openai',
        type: 'oauth',
        credentials: {
          access_token: 'at-opaque-personal-access-token',
          chatgpt_account_id: 'workspace-1',
          chatgpt_user_id: 'user-1',
          email: 'person@example.com',
          plan_type: 'team',
          organization_id: 'org-1',
          expires_at: '2026-10-21T02:37:37Z',
          id_token: '',
          refresh_token: '',
        },
      }],
    });

    const [account] = parseSub2apiJsonAccounts(content);
    const auth = normalizeSub2apiAuth(account);

    expect(auth).toMatchObject({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        access_token: 'at-opaque-personal-access-token',
        id_token: '',
        refresh_token: '',
        account_id: 'workspace-1',
        chatgpt_user_id: 'user-1',
        email: 'person@example.com',
        plan_type: 'team',
        organization_id: 'org-1',
        expires_at: '2026-10-21T02:37:37Z',
      },
    });
  });

  it('imports sub2api accounts without attempting an OAuth token refresh', async () => {
    const admin = {
      createSystemAccount: vi.fn().mockResolvedValue({ id: 'agent-account' }),
    };
    const service = new OfficialAccountImportService({}, admin as unknown as AdminService);
    const content = JSON.stringify({
      type: 'sub2api-data',
      version: 1,
      proxies: [],
      accounts: [{
        platform: 'openai',
        type: 'oauth',
        credentials: {
          auth_mode: 'agentIdentity',
          agent_runtime_id: 'agent-runtime',
          agent_private_key: Buffer.alloc(48, 7).toString('base64'),
          account_id: 'workspace-1',
          chatgpt_user_id: 'user-1',
        },
      }],
    });

    await expect(service.importSub2api(actor, { content })).resolves.toMatchObject({
      importedCount: 1,
    });
    expect(admin.createSystemAccount).toHaveBeenCalledWith(actor, {
      auth: expect.objectContaining({ auth_mode: 'agentIdentity' }),
      note: undefined,
      expiresAt: undefined,
    });
  });

  it('imports every normalized account and applies shared metadata', async () => {
    const token = jwt({ sub: 'compatible-user' });
    const admin = {
      createSystemAccount: vi.fn()
        .mockImplementation(async (_actor, input) => ({ id: input.auth.tokens.access_token })),
    };
    const service = new OfficialAccountImportService({}, admin as unknown as AdminService);

    await expect(service.import(actor, {
      content: JSON.stringify({ accounts: [
        { accessToken: token, refreshToken: 'refresh-one' },
        { tokens: { access_token: `${token}2` } },
      ] }),
      note: 'shared note',
      expiresAt: '2026-07-18T12:00:00.000Z',
    })).resolves.toMatchObject({ importedCount: 2, accounts: [{ id: token }, { id: `${token}2` }] });
    expect(admin.createSystemAccount).toHaveBeenNthCalledWith(1, actor, {
      auth: { tokens: {
        access_token: token,
        refresh_token: 'refresh-one',
        chatgpt_user_id: 'compatible-user',
      } },
      note: 'shared note',
      expiresAt: '2026-07-18T12:00:00.000Z',
    });
  });

  it('refreshes a compatible export that only contains a refresh token', async () => {
    const accessToken = jwt({ sub: 'refreshed-user' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: 'rotated-refresh-token',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const admin = {
      createSystemAccount: vi.fn().mockResolvedValue({ id: 'imported-account' }),
    };
    const service = new OfficialAccountImportService({}, admin as unknown as AdminService);

    await expect(service.import(actor, {
      content: JSON.stringify({ session: { refreshToken: 'refresh-token' } }),
    })).resolves.toMatchObject({ importedCount: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('refresh-token'),
      }),
    );
    expect(admin.createSystemAccount).toHaveBeenCalledWith(actor, {
      auth: { tokens: {
        access_token: accessToken,
        refresh_token: 'rotated-refresh-token',
      } },
      note: undefined,
      expiresAt: undefined,
    });
  });

  it('ignores unrelated objects and reports failures for discovered accounts', async () => {
    const admin = { createSystemAccount: vi.fn() };
    const service = new OfficialAccountImportService({}, admin as unknown as AdminService);
    await expect(service.import(actor, {
      content: '[{"accessToken":"token"},{"email":"missing-token@example.com"}]',
    })).resolves.toMatchObject({ importedCount: 1, skippedCount: 0 });

    admin.createSystemAccount
      .mockResolvedValueOnce({ id: 'first' })
      .mockRejectedValueOnce(new BadRequestException('invalid account'));
    await expect(service.import(actor, {
      content: '[{"accessToken":"one"},{"accessToken":"two"}]',
    })).resolves.toMatchObject({
      importedCount: 1,
      skippedCount: 1,
      skipped: [expect.stringContaining('invalid account')],
    });
  });
});
