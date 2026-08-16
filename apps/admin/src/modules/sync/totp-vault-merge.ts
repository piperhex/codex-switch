import type { PutSyncTotpVaultDto, TotpEntryDto, TotpTombstoneDto } from './dto/sync-totp.dto';

const EMPTY_VAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export type VersionedTotpEntry = TotpEntryDto & { updatedAt: string };

export interface MergedTotpVault {
  entries: VersionedTotpEntry[];
  tombstones: TotpTombstoneDto[];
  modifiedAt: string;
}

interface StoredTotpVault {
  entries: TotpEntryDto[];
  tombstones?: TotpTombstoneDto[];
  modifiedAt: Date;
}

function timestamp(value: string | undefined, fallback: string) {
  return value && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function newestById<T>(items: T[], idOf: (item: T) => string, timeOf: (item: T) => string) {
  const newest = new Map<string, T>();
  for (const item of items) {
    const current = newest.get(idOf(item));
    if (!current || Date.parse(timeOf(current)) <= Date.parse(timeOf(item))) newest.set(idOf(item), item);
  }
  return newest;
}

function versionEntries(entries: TotpEntryDto[], fallback: string): VersionedTotpEntry[] {
  return entries.map((entry) => ({
    ...entry,
    updatedAt: timestamp(entry.updatedAt, fallback),
  }));
}

function normalizeCandidates(
  entries: VersionedTotpEntry[],
  tombstones: TotpTombstoneDto[],
): MergedTotpVault {
  const activeById = newestById(entries, (entry) => entry.id, (entry) => entry.updatedAt);
  const deletedById = newestById(tombstones, (item) => item.id, (item) => item.deletedAt);
  const active: VersionedTotpEntry[] = [];
  const deleted: TotpTombstoneDto[] = [];
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
  const versions = [
    ...active.map((entry) => entry.updatedAt),
    ...deleted.map((item) => item.deletedAt),
  ];
  const modifiedAt = versions.reduce(
    (latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest),
    EMPTY_VAULT_TIMESTAMP,
  );
  return { entries: active, tombstones: deleted, modifiedAt };
}

export function readStoredTotpVault(vault: StoredTotpVault): MergedTotpVault {
  const fallback = vault.modifiedAt.toISOString();
  return normalizeCandidates(
    versionEntries(vault.entries, fallback),
    vault.tombstones ?? [],
  );
}

export function mergeTotpVault(
  existing: StoredTotpVault | null,
  incoming: PutSyncTotpVaultDto,
): MergedTotpVault {
  const stored = existing
    ? readStoredTotpVault(existing)
    : { entries: [], tombstones: [], modifiedAt: EMPTY_VAULT_TIMESTAMP };
  const incomingEntries = versionEntries(incoming.entries, incoming.modifiedAt);
  const incomingTombstones = [...(incoming.tombstones ?? [])];
  if (incoming.tombstones === undefined) {
    const incomingIds = new Set(incomingEntries.map((entry) => entry.id));
    for (const entry of stored.entries) {
      if (!incomingIds.has(entry.id)) incomingTombstones.push({ id: entry.id, deletedAt: incoming.modifiedAt });
    }
  }
  return normalizeCandidates(
    [...stored.entries, ...incomingEntries],
    [...stored.tombstones, ...incomingTombstones],
  );
}
