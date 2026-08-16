import { describe, expect, it } from 'vitest';
import type { TotpEntryDto } from '@/modules/sync/dto/sync-totp.dto';
import { mergeTotpVault } from '@/modules/sync/totp-vault-merge';

const FIRST_ID = '10000000-0000-4000-8000-000000000001';
const SECOND_ID = '20000000-0000-4000-8000-000000000002';

function entry(id: string, updatedAt: string): TotpEntryDto {
  return {
    id,
    issuer: 'Example',
    accountName: `${id}@example.com`,
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt,
  };
}

function stored(entries: TotpEntryDto[], tombstones: Array<{ id: string; deletedAt: string }> = []) {
  return {
    entries,
    tombstones,
    modifiedAt: new Date('2026-08-15T10:00:00.000Z'),
  };
}

describe('2FA vault merging', () => {
  it('preserves additions made concurrently on different devices', () => {
    const result = mergeTotpVault(stored([
      entry(FIRST_ID, '2026-08-15T10:00:00.000Z'),
    ]), {
      entries: [entry(SECOND_ID, '2026-08-15T09:59:59.000Z')],
      tombstones: [],
      modifiedAt: '2026-08-15T09:59:59.000Z',
    });

    expect(result.entries.map((item) => item.id)).toEqual([FIRST_ID, SECOND_ID]);
    expect(result.modifiedAt).toBe('2026-08-15T10:00:00.000Z');
  });

  it('keeps a deletion and an unrelated concurrent addition', () => {
    const result = mergeTotpVault(stored([
      entry(FIRST_ID, '2026-08-15T10:00:00.000Z'),
    ]), {
      entries: [entry(SECOND_ID, '2026-08-15T10:00:02.000Z')],
      tombstones: [{ id: FIRST_ID, deletedAt: '2026-08-15T10:00:01.000Z' }],
      modifiedAt: '2026-08-15T10:00:02.000Z',
    });

    expect(result.entries.map((item) => item.id)).toEqual([SECOND_ID]);
    expect(result.tombstones).toEqual([
      { id: FIRST_ID, deletedAt: '2026-08-15T10:00:01.000Z' },
    ]);
  });

  it('lets a tombstone beat stale and equally-timed active records', () => {
    const result = mergeTotpVault(stored([], [
      { id: FIRST_ID, deletedAt: '2026-08-15T10:00:00.000Z' },
    ]), {
      entries: [entry(FIRST_ID, '2026-08-15T10:00:00.000Z')],
      tombstones: [],
      modifiedAt: '2026-08-15T10:00:00.000Z',
    });

    expect(result.entries).toEqual([]);
    expect(result.tombstones).toHaveLength(1);
  });

  it('accepts a genuinely newer version of the same record', () => {
    const result = mergeTotpVault(stored([], [
      { id: FIRST_ID, deletedAt: '2026-08-15T10:00:00.000Z' },
    ]), {
      entries: [entry(FIRST_ID, '2026-08-15T10:00:01.000Z')],
      tombstones: [],
      modifiedAt: '2026-08-15T10:00:01.000Z',
    });

    expect(result.entries.map((item) => item.id)).toEqual([FIRST_ID]);
    expect(result.tombstones).toEqual([]);
  });

  it('infers legacy whole-snapshot deletions and versions legacy entries', () => {
    const legacyEntry = entry(FIRST_ID, '2026-08-15T08:00:00.000Z');
    delete legacyEntry.updatedAt;
    const result = mergeTotpVault(stored([
      legacyEntry,
      entry(SECOND_ID, '2026-08-15T10:00:00.000Z'),
    ]), {
      entries: [legacyEntry],
      modifiedAt: '2026-08-15T10:00:01.000Z',
    });

    expect(result.entries).toEqual([
      expect.objectContaining({ id: FIRST_ID, updatedAt: '2026-08-15T10:00:01.000Z' }),
    ]);
    expect(result.tombstones).toEqual([
      { id: SECOND_ID, deletedAt: '2026-08-15T10:00:01.000Z' },
    ]);
  });
});
