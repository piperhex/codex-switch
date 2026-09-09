import { x25519 } from '@noble/curves/ed25519';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export function keyPair(random: (length: number) => Uint8Array) {
  const secret = random(32);
  return { secret, publicKey: bytesToHex(x25519.getPublicKey(secret)) };
}

/** Separate nonce namespaces per direction; authenticated session binding and replay rejection. */
export class SessionCipher {
  private readonly key: Uint8Array;
  private readonly context: Uint8Array;
  private sequence = 0;
  private highestReceived = 0;
  private readonly received = new Set<number>();

  constructor(options: { secret: Uint8Array; publicKey: string; sessionId: string; desktop: boolean }) {
    const shared = x25519.getSharedSecret(options.secret, hexToBytes(options.publicKey));
    this.context = utf8ToBytes(`codex-switch-chat-v1:${options.sessionId}`);
    this.key = hkdf(sha256, shared, this.context, 'chat encryption', 32);
    shared.fill(0);
    this.direction = options.desktop ? 1 : 2;
  }

  private readonly direction: number;

  encrypt(text: string) {
    this.sequence += 1;
    if (this.sequence > 0xffffffff) throw new Error('请重新连接电脑。');
    const nonce = new Uint8Array(12);
    const view = new DataView(nonce.buffer);
    view.setUint32(0, this.direction);
    view.setUint32(8, this.sequence);
    const encrypted = chacha20poly1305(this.key, nonce, this.context).encrypt(utf8ToBytes(text));
    return bytesToHex(nonce) + bytesToHex(encrypted);
  }

  decrypt(payload: string): string | null {
    if (payload.length > 40_000 || payload.length < 56 || !/^[a-f0-9]+$/.test(payload)) throw new Error('Invalid packet');
    const bytes = hexToBytes(payload);
    const nonce = bytes.subarray(0, 12);
    const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
    const sequence = view.getUint32(8);
    if (view.getUint32(0) !== (this.direction === 1 ? 2 : 1) || view.getUint32(4) !== 0 || sequence === 0) {
      throw new Error('Invalid nonce');
    }
    if (this.received.has(sequence) || sequence <= this.highestReceived - 1024) return null;
    const plain = chacha20poly1305(this.key, nonce, this.context).decrypt(bytes.subarray(12));
    this.received.add(sequence);
    this.highestReceived = Math.max(this.highestReceived, sequence);
    for (const seen of this.received) if (seen <= this.highestReceived - 1024) this.received.delete(seen);
    // URI decoding also works on Hermes versions that do not provide TextDecoder.
    return decodeURIComponent(Array.from(plain, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
  }

  destroy() { this.key.fill(0); this.received.clear(); }
}
