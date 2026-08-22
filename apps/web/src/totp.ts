import type { TotpAlgorithm, TotpEntry, TotpTombstone, TotpVault } from './types';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const EMPTY_MODIFIED_AT = '1970-01-01T00:00:00.000Z';

function decodeBase32(value: string) {
  const normalized = value.toUpperCase().replace(/[\s=-]/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('2FA 密钥格式不正确');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  return bytes;
}

export function normalizeTotpSecret(value: string) {
  const normalized = value.toUpperCase().replace(/[\s=-]/g, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('2FA 密钥格式不正确');
  }
  decodeBase32(normalized);
  return normalized;
}

export function parseOtpAuthUri(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') {
    throw new Error('只支持 TOTP 二维码');
  }
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const separator = label.indexOf(':');
  const issuerFromLabel = separator >= 0 ? label.slice(0, separator).trim() : '';
  const accountName = separator >= 0 ? label.slice(separator + 1).trim() : label.trim();
  const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();
  const digits = Number(url.searchParams.get('digits') || 6);
  const period = Number(url.searchParams.get('period') || 30);
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) throw new Error('不支持该算法');
  if (digits !== 6 && digits !== 8) throw new Error('验证码位数必须是 6 或 8');
  if (!Number.isInteger(period) || period < 15 || period > 120) throw new Error('验证码周期无效');
  return {
    issuer: url.searchParams.get('issuer')?.trim() || issuerFromLabel,
    accountName,
    secret: normalizeTotpSecret(url.searchParams.get('secret') || ''),
    algorithm: algorithm as TotpAlgorithm,
    digits: digits as 6 | 8,
    period,
  };
}

function counterBytes(counter: number) {
  const bytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

export async function generateTotp(entry: TotpEntry, now = Date.now()) {
  const algorithm = entry.algorithm.replace('SHA', 'SHA-');
  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase32(entry.secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const counter = Math.floor(now / 1000 / entry.period);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  return String(binary % (10 ** entry.digits)).padStart(entry.digits, '0');
}

function newestById<T>(items: T[], idOf: (item: T) => string, timeOf: (item: T) => string) {
  const newest = new Map<string, T>();
  for (const item of items) {
    const current = newest.get(idOf(item));
    if (!current || Date.parse(timeOf(current)) <= Date.parse(timeOf(item))) newest.set(idOf(item), item);
  }
  return newest;
}

export function mergeTotpVaults(first: TotpVault, second: TotpVault): TotpVault {
  const entries = newestById([...first.entries, ...second.entries], (item) => item.id, (item) => item.updatedAt);
  const tombstones = newestById(
    [...first.tombstones, ...second.tombstones],
    (item) => item.id,
    (item) => item.deletedAt,
  );
  const active: TotpEntry[] = [];
  const deleted: TotpTombstone[] = [];
  for (const id of new Set([...entries.keys(), ...tombstones.keys()])) {
    const entry = entries.get(id);
    const tombstone = tombstones.get(id);
    if (entry && (!tombstone || Date.parse(entry.updatedAt) > Date.parse(tombstone.deletedAt))) active.push(entry);
    else if (tombstone) deleted.push(tombstone);
  }
  const timestamps = [...active.map((item) => item.updatedAt), ...deleted.map((item) => item.deletedAt)];
  const modifiedAt = timestamps.reduce(
    (latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest,
    EMPTY_MODIFIED_AT,
  );
  return { entries: active, tombstones: deleted, modifiedAt };
}

export function emptyTotpVault(): TotpVault {
  return { entries: [], tombstones: [], modifiedAt: EMPTY_MODIFIED_AT };
}
