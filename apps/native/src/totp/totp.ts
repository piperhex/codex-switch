import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/sha1';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import * as Crypto from 'expo-crypto';
import type { TotpAlgorithm, TotpDraft, TotpEntry } from './types';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_ISSUER = 'Authenticator';
const MIN_PERIOD_SECONDS = 15;
const MAX_PERIOD_SECONDS = 120;

function parseDigits(value: string | null): 6 | 8 {
  if (value === null || value === '6') return 6;
  if (value === '8') return 8;
  throw new Error('invalid-digits');
}

function parsePeriod(value: string | null) {
  const period = Number(value ?? 30);
  if (!Number.isInteger(period) || period < MIN_PERIOD_SECONDS || period > MAX_PERIOD_SECONDS) {
    throw new Error('invalid-period');
  }
  return period;
}

function parseAlgorithm(value: string | null): TotpAlgorithm {
  const algorithm = (value ?? 'SHA1').toUpperCase();
  if (algorithm === 'SHA1' || algorithm === 'SHA256' || algorithm === 'SHA512') return algorithm;
  throw new Error('invalid-algorithm');
}

function parseLabel(pathname: string) {
  const label = decodeURIComponent(pathname.replace(/^\//, '')).trim();
  const separator = label.indexOf(':');
  if (separator < 0) return { issuer: '', accountName: label };
  return {
    issuer: label.slice(0, separator).trim(),
    accountName: label.slice(separator + 1).trim(),
  };
}

export function normalizeTotpSecret(value: string) {
  const normalized = value.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  const invalid = [...normalized].some((character) => !BASE32_ALPHABET.includes(character));
  if (!normalized || invalid) throw new Error('invalid-secret');
  return normalized;
}

export function parseOtpAuthUri(value: string): TotpDraft {
  const url = new URL(value.trim());
  if (url.protocol !== 'otpauth:' || url.hostname.toLowerCase() !== 'totp') {
    throw new Error('invalid-uri');
  }
  const label = parseLabel(url.pathname);
  const issuer = url.searchParams.get('issuer')?.trim() || label.issuer || DEFAULT_ISSUER;
  return {
    issuer,
    accountName: label.accountName || label.issuer || issuer,
    secret: normalizeTotpSecret(url.searchParams.get('secret') ?? ''),
    algorithm: parseAlgorithm(url.searchParams.get('algorithm')),
    digits: parseDigits(url.searchParams.get('digits')),
    period: parsePeriod(url.searchParams.get('period')),
  };
}

export function createTotpEntry(
  draft: TotpDraft,
  id = Crypto.randomUUID(),
  updatedAt = new Date().toISOString(),
): TotpEntry {
  if (!Number.isInteger(draft.period)
    || draft.period < MIN_PERIOD_SECONDS
    || draft.period > MAX_PERIOD_SECONDS) {
    throw new Error('invalid-period');
  }
  return {
    ...draft,
    id,
    issuer: draft.issuer.trim() || DEFAULT_ISSUER,
    accountName: draft.accountName.trim(),
    secret: normalizeTotpSecret(draft.secret),
    createdAt: updatedAt,
    updatedAt,
  };
}

function decodeBase32(secret: string) {
  let buffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of normalizeTotpSecret(secret)) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
    bitCount += 5;
    if (bitCount < 8) continue;
    bitCount -= 8;
    bytes.push((buffer >>> bitCount) & 0xff);
  }
  return new Uint8Array(bytes);
}

function encodeCounter(counter: number) {
  const bytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = bytes.length - 1; index >= 0 && remaining > 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function sign(algorithm: TotpAlgorithm, key: Uint8Array, message: Uint8Array) {
  if (algorithm === 'SHA256') return hmac(sha256, key, message);
  if (algorithm === 'SHA512') return hmac(sha512, key, message);
  return hmac(sha1, key, message);
}

export function generateTotp(entry: TotpEntry, now = Date.now()) {
  const counter = Math.floor(now / 1000 / entry.period);
  const signature = sign(entry.algorithm, decodeBase32(entry.secret), encodeCounter(counter));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  return String(binary % (10 ** entry.digits)).padStart(entry.digits, '0');
}
