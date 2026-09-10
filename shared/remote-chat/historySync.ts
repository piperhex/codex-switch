import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { Thread, Turn, Item } from './client/types';

export const HISTORY_CHANGED = 'remote-chat/history-changed';
type Fields = Record<string, unknown>;
interface Fingerprint { hash: string; length?: number }
type Manifest = Record<string, Fingerprint>;
interface ItemVersion { id: string; fields: Manifest }
interface TurnVersion extends ItemVersion { items: ItemVersion[] }
export interface HistoryVersion { fields: Manifest; turns: TurnVersion[] }
interface Patch { set: Fields; append: Record<string, string>; remove: string[] }
interface ItemPatch { id: string; patch: Patch }
interface TurnPatch extends ItemPatch { order: string[]; items: ItemPatch[] }
export interface HistoryDelta { threadId: string; patch: Patch; order: string[]; turns: TurnPatch[] }

function validFields(value: unknown): value is Manifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entry]: [string, unknown]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !entry || typeof entry !== 'object') return false;
    const fingerprint = entry as Partial<Fingerprint>;
    return typeof fingerprint.hash === 'string' && /^[a-f0-9]{64}$/.test(fingerprint.hash)
      && (fingerprint.length === undefined || (Number.isSafeInteger(fingerprint.length)
        && fingerprint.length >= 0 && fingerprint.length <= 28 * 1024 * 1024));
  });
}

function validItemVersion(value: unknown): value is ItemVersion {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ItemVersion>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 256 && validFields(item.fields);
}

export function parseHistoryVersion(value: unknown): HistoryVersion | undefined {
  if (value === undefined) return undefined;
  const known = value as Partial<HistoryVersion> | null;
  const valid = known && validFields(known.fields) && Array.isArray(known.turns)
    && known.turns.every((turn) => validItemVersion(turn) && Array.isArray(turn.items)
      && turn.items.every(validItemVersion));
  if (!valid) throw new Error('聊天同步信息已失效，请重新打开聊天。');
  return known as HistoryVersion;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function contentHash(value: unknown) { return bytesToHex(sha256(canonical(value))); }

function fields(value: object, omit: string): Fields {
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => key !== omit && entry !== undefined));
}

function manifest(value: Fields): Manifest {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    { hash: contentHash(entry), ...(typeof entry === 'string' ? { length: entry.length } : {}) }]));
}

/** Only fingerprints and string lengths travel back to the PC, never synchronized message bodies. */
export function historyVersion(thread: Thread): HistoryVersion {
  return { fields: manifest(fields(thread, 'turns')), turns: (thread.turns ?? []).map((turn) => ({
    id: turn.id, fields: manifest(fields(turn, 'items')),
    items: turn.items.map((item) => ({ id: item.id, fields: manifest(fields(item, '')) })),
  })) };
}

function difference(current: Fields, known: Manifest = {}): Patch {
  const patch: Patch = { set: {}, append: {}, remove: Object.keys(known).filter((key) => !(key in current)) };
  for (const [key, value] of Object.entries(current)) {
    const previous = known[key];
    if (previous?.hash === contentHash(value)) continue;
    const length = previous?.length;
    if (typeof value === 'string' && Number.isSafeInteger(length) && length! >= 0
      && length! <= value.length && contentHash(value.slice(0, length)) === previous.hash) {
      patch.append[key] = value.slice(length);
    } else patch.set[key] = value;
  }
  return patch;
}

function changed(patch: Patch) {
  return patch.remove.length > 0 || Object.keys(patch.set).length > 0 || Object.keys(patch.append).length > 0;
}

function turnDifference(turn: Turn, known?: TurnVersion): TurnPatch | undefined {
  const previous = new Map(known?.items.map((item) => [item.id, item]));
  const items = turn.items.map((item) => ({ id: item.id,
    patch: difference(fields(item, ''), previous.get(item.id)?.fields) })).filter((item) => changed(item.patch));
  const patch = difference(fields(turn, 'items'), known?.fields);
  const order = turn.items.map((item) => item.id);
  if (!changed(patch) && !items.length && JSON.stringify(order) === JSON.stringify(known?.items.map((i) => i.id))) {
    return undefined;
  }
  return { id: turn.id, patch, order, items };
}

/** Stateless fingerprints allow reconnects and PC restarts without resending unchanged history. */
export function historyDelta(thread: Thread, known?: HistoryVersion): HistoryDelta {
  const previous = new Map(known?.turns.map((turn) => [turn.id, turn]));
  return { threadId: thread.id, patch: difference(fields(thread, 'turns'), known?.fields),
    order: (thread.turns ?? []).map((turn) => turn.id),
    turns: (thread.turns ?? []).flatMap((turn) => turnDifference(turn, previous.get(turn.id)) ?? []) };
}

function applyFields<T extends object>(value: T, patch: Patch): T {
  const result = { ...value, ...patch.set } as Fields;
  for (const key of patch.remove) delete result[key];
  for (const [key, suffix] of Object.entries(patch.append)) result[key] = String(result[key] ?? '') + suffix;
  return result as T;
}

export function applyHistoryDelta(before: Thread, delta: HistoryDelta): Thread {
  if (before.id !== delta.threadId) throw new Error('聊天已切换，请重新加载。');
  const turns = new Map(before.turns?.map((turn) => [turn.id, turn]));
  for (const update of delta.turns) {
    const turn = turns.get(update.id) ?? { id: update.id, status: 'inProgress', items: [] };
    const items = new Map(turn.items.map((item) => [item.id, item]));
    for (const entry of update.items) items.set(entry.id,
      applyFields(items.get(entry.id) ?? { id: entry.id, type: 'agentMessage' }, entry.patch));
    turns.set(update.id, { ...applyFields(turn, update.patch), items: update.order.map((id) => items.get(id) as Item) });
  }
  return { ...applyFields(before, delta.patch), turns: delta.order.map((id) => turns.get(id) as Turn) };
}
