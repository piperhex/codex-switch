import { describe, expect, it } from 'vitest';
import { earliestExpirationDate } from './expiration';

describe('earliestExpirationDate', () => {
  it('uses the API date when it is earlier than the manually set date', () => {
    expect(earliestExpirationDate(
      '2026-09-30',
      '2026-08-31T12:30:00.000Z',
    )).toBe('2026-08-31');
  });

  it('keeps the manually set date when it is earlier than the API date', () => {
    expect(earliestExpirationDate(
      '2026-07-31',
      '2026-08-31T12:30:00.000Z',
    )).toBe('2026-07-31');
  });

  it('handles either source being absent', () => {
    expect(earliestExpirationDate('', '2026-08-31T12:30:00.000Z')).toBe('2026-08-31');
    expect(earliestExpirationDate('2026-09-30', null)).toBe('2026-09-30');
    expect(earliestExpirationDate('', null)).toBeNull();
  });
});
