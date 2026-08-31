import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary } from '../types';

vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({
  randomUUID: () => '10000000-0000-4000-8000-000000000001',
}));

import {
  consumeAccountQuota,
  consumeAccountsQuota,
  quotaConsumptionTargets,
} from './quotaConsumption';

function account(id: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id,
    email: `${id}@example.com`,
    note: '',
    expiresAt: '',
    plan: 'plus',
    accountId: `workspace-${id}`,
    codexAccessToken: `token-${id}`,
    active: true,
    usage: {},
    ...overrides,
  };
}

function completedResponse() {
  return new Response([
    'data: {"type":"response.created"}',
    '',
    'data: {"type":"response.completed","response":{"id":"resp-1"}}',
    '',
    'data: [DONE]',
  ].join('\n'), { status: 200 });
}

describe('mobile quota consumption', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a quota-consuming conversation directly from the mobile client', async () => {
    const apiFetch = vi.fn().mockResolvedValue(completedResponse());
    vi.stubGlobal('fetch', apiFetch);

    await expect(consumeAccountQuota(account('one'))).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      'https://chatgpt.com/backend-api/codex/responses',
    );
    const request = apiFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-one');
    expect(headers.get('ChatGPT-Account-Id')).toBe('workspace-one');
    expect(headers.get('session-id')).toBe('10000000-0000-4000-8000-000000000001');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual(expect.objectContaining({
      model: 'gpt-5.6-sol',
      stream: true,
      input: expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
      ]),
    }));
  });

  it('rejects a response stream that never confirms completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'data: {"type":"response.failed"}\n\ndata: [DONE]\n',
      { status: 200 },
    )));

    await expect(consumeAccountQuota(account('one')))
      .rejects.toThrow('Codex 未确认额度消耗完成');
  });

  it('continues consuming remaining accounts after one account fails', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"message":"token expired"}', { status: 401 }))
      .mockResolvedValue(completedResponse());
    vi.stubGlobal('fetch', apiFetch);

    const result = await consumeAccountsQuota([account('one'), account('two')]);

    expect(result.consumedAccounts.map((item) => item.id)).toEqual(['two']);
    expect(result.failures).toEqual([{
      accountId: 'one',
      message: 'Codex 登录凭据已过期，请先在桌面端刷新并同步该账号',
    }]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('only targets unique accounts that have a mobile Codex token', () => {
    expect(quotaConsumptionTargets([
      account('one'),
      account('one'),
      account('two', { codexAccessToken: ' ' }),
      account('three'),
    ]).map((item) => item.id)).toEqual(['one', 'three']);
  });
});
