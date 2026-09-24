import { afterEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  Platform: { OS: 'android' },
  NativeModules: { ChatPacketCipher: undefined as unknown },
}));
vi.mock('react-native', () => runtime);
import { createNativePacketCipher } from './packetCipher';

const material = { key: new Uint8Array(32), context: new Uint8Array([1, 2]) };
afterEach(() => { runtime.Platform.OS = 'android'; runtime.NativeModules.ChatPacketCipher = undefined; });

it('uses the portable implementation when the Android module or algorithm is unavailable', () => {
  expect(createNativePacketCipher(material)).toBeUndefined();
  runtime.NativeModules.ChatPacketCipher = { available: false };
  expect(createNativePacketCipher(material)).toBeUndefined();
  runtime.Platform.OS = 'ios';
  runtime.NativeModules.ChatPacketCipher = { available: true };
  expect(createNativePacketCipher(material)).toBeUndefined();
});

it('never falls back or returns unauthenticated data after a native packet error', () => {
  const native = { available: true, create: vi.fn(() => 'opaque-handle'),
    encrypt: vi.fn(() => null), decrypt: vi.fn(() => null), destroy: vi.fn() };
  runtime.NativeModules.ChatPacketCipher = native;
  const cipher = createNativePacketCipher(material)!;
  expect(native.create).toHaveBeenCalledWith('00'.repeat(32), '0102');
  expect(() => cipher.decrypt('corrupt')).toThrow('Invalid encrypted packet');
  expect(() => cipher.encrypt('plain', 'nonce')).toThrow('Invalid encrypted packet');
  cipher.destroy();
  expect(native.destroy).toHaveBeenCalledWith('opaque-handle');
});

it('surfaces native session creation failures without silently using a different key', () => {
  runtime.NativeModules.ChatPacketCipher = { available: true, create: () => null };
  expect(() => createNativePacketCipher(material)).toThrow('Unable to initialize encrypted session');
});

it('preserves embedded NULs across JNI input and output conversion', () => {
  const native = { available: true, create: () => 'session', encrypt: vi.fn(() => 'encrypted'),
    decrypt: () => ({ text: 'a\0b' }), destroy: vi.fn() };
  runtime.NativeModules.ChatPacketCipher = native;
  const cipher = createNativePacketCipher(material)!;
  expect(cipher.encrypt('a\0b', 'nonce')).toBe('encrypted');
  expect(native.encrypt).toHaveBeenCalledWith('session', { utf8Hex: '610062' }, 'nonce');
  expect(cipher.decrypt('packet')).toBe('a\0b');
});
