import { describe, expect, it } from 'vitest';
import type { AccountSummary } from '../types';
import { mergeRefreshedUsage, mergeServerAccounts } from './accounts';

function account(id: string, note: string, usedPercent: number): AccountSummary {
  return {
    id,
    email: `${id}@example.com`,
    note,
    expiresAt: '',
    plan: 'plus',
    active: false,
    usage: { primary: { usedPercent, remainingPercent: 100 - usedPercent } },
    privateDetails: { password: '', phoneNumber: '', totpSecret: '' },
  };
}

describe('mobile account refresh merging', () => {
  it('applies server metadata without replacing current usage', () => {
    const current = account('account-1', 'old note', 20);
    const server = {
      ...account('account-1', 'new note', 90),
      privateDetails: { password: '', phoneNumber: '', totpSecret: 'JBSWY3DPEHPK3PXP' },
    };

    const result = mergeServerAccounts([current], [server]);

    expect(result[0]?.note).toBe('new note');
    expect(result[0]?.privateDetails?.totpSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(result[0]?.usage).toEqual(current.usage);
  });

  it('applies refreshed usage without replacing current server metadata', () => {
    const current = account('account-1', 'latest note', 20);
    const refreshed = { ...account('account-1', 'stale note', 35), plan: 'pro' };

    const result = mergeRefreshedUsage([current], [refreshed]);

    expect(result[0]?.note).toBe('latest note');
    expect(result[0]?.plan).toBe('pro');
    expect(result[0]?.usage).toEqual(refreshed.usage);
  });
});
