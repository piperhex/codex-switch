import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateNativeEntries } = require('./verify-apk.cjs') as {
  validateNativeEntries: (entries: string[]) => string;
};
const architectures = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
const runtimeLibraries = [
  'appmodules', 'c++_shared', 'expo-modules-core', 'expo-sqlite', 'fbjni',
  'gesturehandler', 'hermes', 'reactnative', 'reanimated', 'worklets',
];
const completeApk = architectures.flatMap((abi) => runtimeLibraries.map((name) => `lib/${abi}/lib${name}.so`));

describe('release APK native libraries', () => {
  it('accepts complete libraries for phones and emulators', () => {
    expect(validateNativeEntries([...completeApk, 'classes.dex', 'assets/index.android.bundle']))
      .toContain('arm64-v8a: 10 libraries');
  });

  it('rejects the mixed APK where only the emulator has Expo, gestures and animations', () => {
    const emulatorOnly = /lib(expo-modules-core|gesturehandler|reanimated|worklets)\.so$/;
    const brokenApk = completeApk.filter((entry) => entry.includes('/x86_64/') || !emulatorOnly.test(entry));
    expect(() => validateNativeEntries(brokenApk)).toThrow('lib/arm64-v8a/libexpo-modules-core.so');
  });

  it('rejects an emulator-only APK even when its runtime is complete', () => {
    expect(() => validateNativeEntries(completeApk.filter((entry) => entry.includes('/x86_64/'))))
      .toThrow('lib/arm64-v8a/libreactnative.so');
  });

  it('rejects a runtime library omitted from every architecture', () => {
    expect(() => validateNativeEntries(completeApk.filter((entry) => !entry.endsWith('/libexpo-modules-core.so'))))
      .toThrow('lib/arm64-v8a/libexpo-modules-core.so');
  });

  it('checks additional dependency libraries for every architecture', () => {
    expect(() => validateNativeEntries([...completeApk, 'lib/x86_64/libadditional-module.so']))
      .toThrow('lib/arm64-v8a/libadditional-module.so');
  });

  it('rejects archives with no native libraries', () => {
    expect(() => validateNativeEntries(['classes.dex'])).toThrow('APK is missing native libraries');
  });
});
