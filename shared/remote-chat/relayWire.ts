import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const MAGIC = [67, 83, 66, 49]; // CSB1: session length, ASCII session ID, authenticated ciphertext.
const MAX_SESSION_BYTES = 128;
const MAX_PAYLOAD_BYTES = 20_000;
const HEADER_BYTES = MAGIC.length + 1;

/** Binary encoding is hop-local; legacy peers still receive the original JSON envelope. */
export function encodeRelay(data: string): string | Uint8Array {
  const frame = JSON.parse(data) as Record<string, unknown>;
  if (frame.type !== 'relay') return data;
  const { sessionId, payload } = frame;
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)
    || typeof payload !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(payload)
    || payload.length > MAX_PAYLOAD_BYTES * 2) throw new Error('Invalid relay');
  const bytes = hexToBytes(payload);
  const wire = new Uint8Array(HEADER_BYTES + sessionId.length + bytes.length);
  wire.set(MAGIC);
  wire[MAGIC.length] = sessionId.length;
  for (let index = 0; index < sessionId.length; index += 1) wire[HEADER_BYTES + index] = sessionId.charCodeAt(index);
  wire.set(bytes, HEADER_BYTES + sessionId.length);
  return wire;
}

export function decodeRelay(data: ArrayBuffer): string {
  const wire = new Uint8Array(data);
  const length = wire[MAGIC.length];
  const payload = wire.subarray(HEADER_BYTES + length);
  if (!MAGIC.every((byte, index) => wire[index] === byte) || !length || length > MAX_SESSION_BYTES
    || !payload.length || payload.length > MAX_PAYLOAD_BYTES) throw new Error('Invalid relay');
  const sessionId = String.fromCharCode(...wire.subarray(HEADER_BYTES, HEADER_BYTES + length));
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid session');
  return JSON.stringify({ type: 'relay', sessionId, payload: bytesToHex(payload) });
}
