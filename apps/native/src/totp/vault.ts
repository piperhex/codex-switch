import type { TotpEntry, TotpTombstone, TotpVault } from './types';

const BASE32_SECRET_PATTERN = /^[A-Z2-7]+$/;
const MIN_PERIOD_SECONDS = 15;
const MAX_PERIOD_SECONDS = 120;
const EMPTY_VAULT_MODIFIED_AT = '1970-01-01T00:00:00.000Z';

function hasValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isTotpEntryCore(value: unknown): value is Omit<TotpEntry, 'updatedAt'> {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<TotpEntry>;
  return typeof entry.id === 'string'
    && typeof entry.issuer === 'string'
    && typeof entry.accountName === 'string'
    && typeof entry.secret === 'string'
    && BASE32_SECRET_PATTERN.test(entry.secret)
    && hasValidTimestamp(entry.createdAt)
    && ['SHA1', 'SHA256', 'SHA512'].includes(entry.algorithm ?? '')
    && (entry.digits === 6 || entry.digits === 8)
    && Number.isInteger(entry.period)
    && (entry.period ?? 0) >= MIN_PERIOD_SECONDS
    && (entry.period ?? 0) <= MAX_PERIOD_SECONDS;
}

export function normalizeTotpEntry(value: unknown, fallback: string): TotpEntry | null {
  if (!isTotpEntryCore(value)) return null;
  const entry = value as Omit<TotpEntry, 'updatedAt'> & { updatedAt?: string };
  return { ...entry, updatedAt: hasValidTimestamp(entry.updatedAt) ? entry.updatedAt : fallback };
}

function isTotpTombstone(value: unknown): value is TotpTombstone {
  if (!value || typeof value !== 'object') return false;
  const tombstone = value as Partial<TotpTombstone>;
  return typeof tombstone.id === 'string' && hasValidTimestamp(tombstone.deletedAt);
}

function newestById<T>(items: T[], idOf: (item: T) => string, timeOf: (item: T) => string) {
  const newest = new Map<string, T>();
  for (const item of items) {
    const current = newest.get(idOf(item));
    if (!current || Date.parse(timeOf(current)) <= Date.parse(timeOf(item))) newest.set(idOf(item), item);
  }
  return newest;
}

function canonicalTotpVault(entries: TotpEntry[], tombstones: TotpTombstone[]): TotpVault {
  const activeById = newestById(entries, (entry) => entry.id, (entry) => entry.updatedAt);
  const deletedById = newestById(tombstones, (item) => item.id, (item) => item.deletedAt);
  const active: TotpEntry[] = [];
  const deleted: TotpTombstone[] = [];
  const ids = new Set([...activeById.keys(), ...deletedById.keys()]);
  for (const id of ids) {
    const entry = activeById.get(id);
    const tombstone = deletedById.get(id);
    if (entry && (!tombstone || Date.parse(entry.updatedAt) > Date.parse(tombstone.deletedAt))) {
      active.push(entry);
    } else if (tombstone) {
      deleted.push(tombstone);
    }
  }
  const versions = [...active.map((entry) => entry.updatedAt), ...deleted.map((item) => item.deletedAt)];
  const modifiedAt = versions.reduce(
    (latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest),
    EMPTY_VAULT_MODIFIED_AT,
  );
  return { entries: active, tombstones: deleted, modifiedAt };
}

export function normalizeTotpVault(value: unknown): TotpVault | null {
  if (!value || typeof value !== 'object') return null;
  const vault = value as Partial<TotpVault>;
  if (!Array.isArray(vault.entries)) return null;
  const fallback = hasValidTimestamp(vault.modifiedAt)
    ? vault.modifiedAt
    : EMPTY_VAULT_MODIFIED_AT;
  const entries = vault.entries
    .map((entry) => normalizeTotpEntry(entry, fallback))
    .filter((entry): entry is TotpEntry => entry !== null);
  const tombstones = Array.isArray(vault.tombstones) ? vault.tombstones.filter(isTotpTombstone) : [];
  return canonicalTotpVault(entries, tombstones);
}

export function mergeTotpVaults(first: TotpVault, second: TotpVault): TotpVault {
  return canonicalTotpVault(
    [...first.entries, ...second.entries],
    [...first.tombstones, ...second.tombstones],
  );
}

export function totpVaultsEqual(first: TotpVault, second: TotpVault) {
  return JSON.stringify(first) === JSON.stringify(second);
}
