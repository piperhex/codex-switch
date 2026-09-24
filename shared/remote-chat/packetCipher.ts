/** Optional platform implementation of the existing ChaCha20-Poly1305 wire format. */
export interface PacketCipher {
  encrypt(text: string, nonceHex: string): string;
  decrypt(payload: string): string;
  destroy(): void;
}

/** The implementation must copy key material; the caller retains and clears its buffers. */
export type PacketCipherFactory = (material: {
  key: Uint8Array; context: Uint8Array;
}) => PacketCipher | undefined;
