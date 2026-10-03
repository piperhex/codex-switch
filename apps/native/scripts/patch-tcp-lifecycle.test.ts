import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchClient, patchModule, patchServer } = require('./patch-tcp-lifecycle.cjs') as {
  patchClient: (source: string) => string;
  patchModule: (source: string) => string;
  patchServer: (source: string) => string;
};
const directory = join(dirname(require.resolve('react-native-tcp-socket/package.json')),
  'android/src/main/java/com/asterinet/react/tcpsocket');

it.each([
  ['TcpSocketClient.java', patchClient], ['TcpSocketModule.java', patchModule],
  ['TcpSocketServer.java', patchServer],
] as const)('patches %s idempotently and rejects upstream drift', (name, patch) => {
  const source = readFileSync(join(directory, name), 'utf8');
  const patched = patch(source);
  expect(patch(patched)).toBe(patched);
  const crlf = patched.replace(/\r?\n/g, '\r\n');
  expect(patch(crlf)).toBe(crlf);
  expect(() => patch('upstream changed')).toThrow('source changed');
  expect(() => patch(source + source)).toThrow('source changed');
});
