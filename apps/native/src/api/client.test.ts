import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary, AuthSession } from '../types';
import type { TotpVault } from '../totp/types';

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import {
  consumeResetCredit,
  deleteRemoteDevice,
  fetchAccountSummary,
  fetchAccountUsage,
  fetchResetCredits,
  pollAccountOAuth,
  startAccountOAuth,
  syncTotpVault,
  updateAccountDetails,
} from './client';

const session: AuthSession = {
  baseUrl: 'https://switch.example.com',
  accessToken: 'switch-access',
  refreshToken: 'switch-refresh',
  email: 'owner@example.com',
};

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'account-1',
    email: 'account@example.com',
    note: '',
    expiresAt: '',
    plan: 'plus',
    accountId: 'workspace-1',
    codexAccessToken: 'codex-access',
    active: true,
    usage: {},
    ...overrides,
  };
}

describe('mobile Codex API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the backend usage snapshot with a live Codex response', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accounts: [account({
          privateDetails: {
            password: 'account-password',
            phoneNumber: '+65 6123 4567',
            totpSecret: 'JBSWY3DPEHPK3PXP',
          },
          usage: {
            primary: { usedPercent: 99, remainingPercent: 1 },
            fetchedAt: '2026-01-01T00:00:00.000Z',
          },
        })],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        plan_type: 'pro',
        promo: {
          offer: {
            valid_until: '2026-08-31T12:30:00Z',
            ends_at: '2026-09-30T12:30:00Z',
          },
        },
        rate_limit: {
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 18_000,
            reset_at: 1_800_000_000,
          },
          secondary_window: {
            used_percent: 40,
            limit_window_seconds: 604_800,
            reset_at: 1_800_100_000,
          },
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    const result = await fetchAccountSummary(session);

    expect(result[0]?.usage).toEqual(expect.objectContaining({
      primary: {
        usedPercent: 25,
        remainingPercent: 75,
        resetsAt: 1_800_000_000,
        windowMinutes: 300,
      },
      secondary: {
        usedPercent: 40,
        remainingPercent: 60,
        resetsAt: 1_800_100_000,
        windowMinutes: 10_080,
      },
      apiExpiresAt: '2026-08-31T12:30:00.000Z',
      plan: 'pro',
      error: null,
    }));
    expect(result[0]?.plan).toBe('pro');
    expect(result[0]?.privateDetails).toEqual({
      password: 'account-password',
      phoneNumber: '+65 6123 4567',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    expect(apiFetch.mock.calls[1]?.[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
    const headers = new Headers((apiFetch.mock.calls[1]?.[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer codex-access');
    expect(headers.get('ChatGPT-Account-Id')).toBe('workspace-1');
    expect(headers.get('originator')).toBe('codex_cli_rs');
  });

  it('does not fall back to stale backend usage when no Codex token is available', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      accounts: [account({
        codexAccessToken: undefined,
        usage: {
          primary: { usedPercent: 10, remainingPercent: 90 },
          fetchedAt: '2026-01-01T00:00:00.000Z',
        },
      })],
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    const result = await fetchAccountSummary(session);

    expect(result[0]?.usage.primary).toBeNull();
    expect(result[0]?.usage.error).toContain('没有可用于手机直连的 Codex Token');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes one account usage without requesting the account list', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      rate_limit: {
        primary_window: {
          used_percent: 35,
          limit_window_seconds: 18_000,
          reset_at: 1_800_000_000,
        },
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchAccountUsage(account())).resolves.toEqual(expect.objectContaining({
      primary: {
        usedPercent: 35,
        remainingPercent: 65,
        resetsAt: 1_800_000_000,
        windowMinutes: 300,
      },
      apiExpiresAt: null,
      plan: null,
      error: null,
    }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
  });

  it('reads and normalizes reset credits directly from Codex', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      credits: [{
        granted_at: 1_753_056_000,
        expires_at: '2026-08-20T10:30:00.000Z',
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchResetCredits(account())).resolves.toEqual({
      credits: [{
        issuedAt: '2025-07-21T00:00:00.000Z',
        expiresAt: '2026-08-20T10:30:00.000Z',
      }],
    });
    expect(apiFetch.mock.calls[0]?.[0])
      .toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits');
  });

  it('checks current credits and consumes one directly through Codex', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        credits: [{ granted_at: 1_753_056_000, expires_at: 1_756_000_000 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'reset' }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(consumeResetCredit(account())).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1]?.[0])
      .toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume');
    const request = apiFetch.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual({
      redeem_request_id: expect.stringMatching(/^codex-switch-mobile-/),
    });
  });

  it('deletes an offline desktop device through the cloud API', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(deleteRemoteDevice(session, 'device/1')).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      'https://switch.example.com/devices/device%2F1',
    );
    expect(apiFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    const headers = new Headers((apiFetch.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer switch-access');
  });

  it('synchronizes the mobile 2FA vault only when explicitly requested', async () => {
    const vault: TotpVault = {
      entries: [],
      modifiedAt: '2026-08-15T10:00:00.000Z',
    };
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(vault), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(syncTotpVault(session, vault)).resolves.toEqual(vault);

    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://switch.example.com/sync/totp');
    const request = apiFetch.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('PUT');
    expect(JSON.parse(request.body as string)).toEqual(vault);
  });

  it('starts mobile OAuth, polls it, and updates editable account details', async () => {
    const oauth = {
      sessionId: 'oauth-session',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH',
      interval: 2,
      expiresIn: 900,
    };
    const details = {
      note: 'Mobile note',
      expiresAt: '2026-12-31',
      privateDetails: {
        password: 'account-password',
        phoneNumber: '+65 6123 4567',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
    };
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(oauth), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(account(details)), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(startAccountOAuth(session)).resolves.toEqual(oauth);
    await expect(pollAccountOAuth(session, 'oauth/session')).resolves.toEqual({ status: 'pending' });
    await expect(updateAccountDetails(session, 'account/1', details))
      .resolves.toEqual(expect.objectContaining(details));

    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/oauth/start',
    );
    expect(apiFetch.mock.calls[1]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/oauth/oauth%2Fsession/poll',
    );
    expect(apiFetch.mock.calls[2]?.[0]).toBe(
      'https://switch.example.com/sync/accounts/account%2F1/details',
    );
    expect(JSON.parse((apiFetch.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual(details);
  });
});
