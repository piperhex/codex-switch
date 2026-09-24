import { NativeModules, Platform } from 'react-native';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { PacketCipherFactory } from '../../../../shared/remote-chat/packetCipher';

interface NativePacketCipher {
  available: boolean;
  create(key: string, context: string): string | null;
  encrypt(handle: string, input: { text: string } | { utf8Hex: string }, nonce: string): string | null;
  decrypt(handle: string, packet: string): { text: string } | null;
  destroy(handle: string): boolean;
}

function authenticated(value: string | null): string {
  if (value === null) throw new Error('Invalid encrypted packet');
  return value;
}

/** One bounded native call performs crypto, hex and UTF-8 conversion without copying arrays through Hermes. */
export const createNativePacketCipher: PacketCipherFactory = ({ key, context }) => {
  const native = NativeModules.ChatPacketCipher as NativePacketCipher | undefined;
  if (Platform.OS !== 'android' || !native?.available) return undefined;
  const handle = native.create(bytesToHex(key), bytesToHex(context));
  if (handle === null) throw new Error('Unable to initialize encrypted session');
  return {
    // JNI input strings truncate at NUL, including map entries. JSON packets never contain literal NULs,
    // but preserve arbitrary SessionCipher strings through a bounded, uncommon hex input path.
    encrypt: (text, nonce) => authenticated(native.encrypt(handle,
      text.includes('\0') ? { utf8Hex: bytesToHex(utf8ToBytes(text)) } : { text }, nonce)),
    decrypt: (packet) => authenticated(native.decrypt(handle, packet)?.text ?? null),
    destroy: () => { native.destroy(handle); },
  };
};
