export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpEntry {
  id: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  createdAt: string;
}

export type TotpDraft = Omit<TotpEntry, "id" | "createdAt">;

export interface TotpVault {
  entries: TotpEntry[];
  modifiedAt: string;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_ISSUER = "Authenticator";
const MIN_PERIOD_SECONDS = 15;
const MAX_PERIOD_SECONDS = 120;

function decodeLabel(pathname: string) {
  const label = decodeURIComponent(pathname.replace(/^\//, "")).trim();
  const separator = label.indexOf(":");
  if (separator < 0) return { issuer: "", accountName: label };
  return {
    issuer: label.slice(0, separator).trim(),
    accountName: label.slice(separator + 1).trim(),
  };
}

function parseDigits(value: string | null): 6 | 8 {
  return value === "8" ? 8 : 6;
}

function parsePeriod(value: string | null) {
  const period = Number(value ?? 30);
  if (!Number.isInteger(period) || period < MIN_PERIOD_SECONDS || period > MAX_PERIOD_SECONDS) {
    throw new Error("invalid-period");
  }
  return period;
}

function parseAlgorithm(value: string | null): TotpAlgorithm {
  const algorithm = (value ?? "SHA1").toUpperCase();
  if (algorithm !== "SHA1" && algorithm !== "SHA256" && algorithm !== "SHA512") {
    throw new Error("invalid-algorithm");
  }
  return algorithm;
}

export function normalizeTotpSecret(value: string) {
  const normalized = value.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!normalized || [...normalized].some((character) => !BASE32_ALPHABET.includes(character))) {
    throw new Error("invalid-secret");
  }
  return normalized;
}

export function parseOtpAuthUri(value: string): TotpDraft {
  const url = new URL(value.trim());
  if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp") {
    throw new Error("invalid-uri");
  }
  const label = decodeLabel(url.pathname);
  const issuer = url.searchParams.get("issuer")?.trim() || label.issuer || DEFAULT_ISSUER;
  const accountName = label.accountName || label.issuer || issuer;
  return {
    issuer,
    accountName,
    secret: normalizeTotpSecret(url.searchParams.get("secret") ?? ""),
    algorithm: parseAlgorithm(url.searchParams.get("algorithm")),
    digits: parseDigits(url.searchParams.get("digits")),
    period: parsePeriod(url.searchParams.get("period")),
  };
}

function createTotpId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
    + `-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createTotpEntry(draft: TotpDraft, id: string = createTotpId()): TotpEntry {
  if (!Number.isInteger(draft.period)
    || draft.period < MIN_PERIOD_SECONDS
    || draft.period > MAX_PERIOD_SECONDS) {
    throw new Error("invalid-period");
  }
  return {
    ...draft,
    issuer: draft.issuer.trim() || DEFAULT_ISSUER,
    accountName: draft.accountName.trim(),
    secret: normalizeTotpSecret(draft.secret),
    id,
    createdAt: new Date().toISOString(),
  };
}

export function isTotpEntry(value: unknown): value is TotpEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<TotpEntry>;
  try {
    normalizeTotpSecret(entry.secret ?? "");
  } catch {
    return false;
  }
  return typeof entry.id === "string"
    && typeof entry.issuer === "string"
    && typeof entry.accountName === "string"
    && typeof entry.createdAt === "string"
    && (entry.algorithm === "SHA1" || entry.algorithm === "SHA256" || entry.algorithm === "SHA512")
    && (entry.digits === 6 || entry.digits === 8)
    && typeof entry.period === "number"
    && Number.isInteger(entry.period)
    && entry.period >= MIN_PERIOD_SECONDS
    && entry.period <= MAX_PERIOD_SECONDS;
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

function cryptoAlgorithm(algorithm: TotpAlgorithm) {
  return algorithm.replace("SHA", "SHA-");
}

export async function generateTotp(entry: TotpEntry, now = Date.now()) {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(entry.secret),
    { name: "HMAC", hash: cryptoAlgorithm(entry.algorithm) },
    false,
    ["sign"],
  );
  const counter = Math.floor(now / 1000 / entry.period);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encodeCounter(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  return String(binary % (10 ** entry.digits)).padStart(entry.digits, "0");
}
