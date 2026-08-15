import { describe, expect, it, vi } from 'vitest';
import { generateTotp, parseOtpAuthUri } from './totp';

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
});
