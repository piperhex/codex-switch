import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchIos, patchAndroid } = require('./patch-webrtc-audio.cjs') as {
  patchIos: (source: string) => string; patchAndroid: (source: string) => string;
};
const root = dirname(require.resolve('react-native-webrtc/package.json'));

it.each([
  ['ios/RCTWebRTC/WebRTCModule.m', patchIos, 'AVAudioSessionCategoryPlayback'],
  ['android/src/main/java/com/oney/WebRTCModule/WebRTCModule.java', patchAndroid, 'USAGE_MEDIA'],
] as const)('configures receive-only sound in %s and rejects changed upstream code', (file, patch, category) => {
  const source = readFileSync(join(root, file), 'utf8');
  const changed = patch(source);
  expect(changed).toContain(category);
  expect(patch(changed)).toBe(changed);
  const crlf = changed.replace(/\r?\n/g, '\r\n');
  expect(patch(crlf)).toBe(crlf);
  expect(() => patch('upstream changed')).toThrow('WebRTC source changed');
  expect(() => patch(source + source)).toThrow('WebRTC source changed');
});
