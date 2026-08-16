import { describe, expect, it, vi } from 'vitest';
import {
  generateTotp,
  parseOtpAuthUri,
} from './totp';
import { mergeTotpVaults, normalizeTotpVault } from './vault';

vi.mock('expo-crypto', () => ({
  randomUUID: () => '10000000-0000-4000-8000-000000000001',
}));

describe('mobile TOTP', () => {
  it('matches the RFC 6238 SHA1 vector', () => {
    const draft = parseOtpAuthUri(
      'otpauth://totp/Test:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&period=30',
    );
    expect(generateTotp({
      ...draft,
      id: '10000000-0000-4000-8000-000000000001',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    }, 59_000)).toBe('94287082');
  });

  it('reads standard Authenticator metadata', () => {
    expect(parseOtpAuthUri(
      'otpauth://totp/Test%20Service:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Test%20Service',
    )).toMatchObject({
      issuer: 'Test Service',
      accountName: 'alice@example.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  it('migrates legacy entries to per-entry timestamps', () => {
    const vault = normalizeTotpVault({
      entries: [{
        id: '10000000-0000-4000-8000-000000000001',
        issuer: 'Example',
        accountName: 'person@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        createdAt: '2026-08-15T09:00:00.000Z',
      }],
      modifiedAt: '2026-08-15T10:00:00.000Z',
    });

    expect(vault?.entries[0]?.updatedAt).toBe('2026-08-15T10:00:00.000Z');
    expect(vault?.tombstones).toEqual([]);
  });

  it('merges concurrent active and deleted records by id', () => {
    const first = normalizeTotpVault({
      entries: [],
      tombstones: [{
        id: '10000000-0000-4000-8000-000000000001',
        deletedAt: '2026-08-15T10:00:00.000Z',
      }],
      modifiedAt: '2026-08-15T10:00:00.000Z',
    });
    const second = normalizeTotpVault({
      entries: [{
        id: '20000000-0000-4000-8000-000000000002',
        issuer: 'Example',
        accountName: 'person@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        createdAt: '2026-08-15T10:00:01.000Z',
        updatedAt: '2026-08-15T10:00:01.000Z',
      }],
      tombstones: [],
      modifiedAt: '2026-08-15T10:00:01.000Z',
    });

    expect(first && second ? mergeTotpVaults(first, second) : null).toMatchObject({
      entries: [{ id: '20000000-0000-4000-8000-000000000002' }],
      tombstones: [{ id: '10000000-0000-4000-8000-000000000001' }],
    });
  });
});
