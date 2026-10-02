import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const HASH_CHUNK_CHARS = 8 * 1024;
const HASH_BUDGET_MS = 4;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function chunkEnd(value: string, start: number) {
  const end = Math.min(start + HASH_CHUNK_CHARS, value.length);
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  // JSON.stringify escapes lone surrogates; keep a valid pair in the same chunk.
  return last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end - 1 : end;
}

/** Match contentHash(string) without serializing or hashing a whole image in one JS task. */
export async function contentStringHash(value: string): Promise<string> {
  const digest = sha256.create();
  let started = performance.now();
  digest.update('"');
  for (let offset = 0; offset < value.length;) {
    const end = chunkEnd(value, offset);
    digest.update(JSON.stringify(value.slice(offset, end)).slice(1, -1));
    offset = end;
    if (offset < value.length && performance.now() - started >= HASH_BUDGET_MS) {
      await pause();
      started = performance.now();
    }
  }
  return bytesToHex(digest.update('"').digest());
}
