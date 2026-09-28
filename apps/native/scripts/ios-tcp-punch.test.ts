import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchClient, applyIosTcpPunchPatch } = require('./patch-ios-tcp-punch.cjs') as {
  patchClient: (source: string) => string; applyIosTcpPunchPatch: (directory: string) => void;
};
const { addTcpPunchHook } = require('../plugins/withIosTcpPunch.cjs') as {
  addTcpPunchHook: (source: string) => string;
};
const { patchPods } = require('./patch-cocoa-tcp-punch.cjs') as {
  patchPods: (directory: string, version?: string) => void;
};
const dependency = dirname(require.resolve('react-native-tcp-socket/package.json'));

it('keeps iOS socket patching idempotent and normalizes both wildcard families before binding', () => {
  applyIosTcpPunchPatch(dependency);
  const original = readFileSync(join(dependency, 'ios/TcpSocketClient.m'), 'utf8').replace(/\r\n/g, '\n');
  expect(patchClient(original)).toBe(original);
  expect(original.match(/csw_reusePort = \[options\[@"reusePort"\] boolValue\]/g)).toHaveLength(2);
  expect(original).toContain('localAddress = @"";');
  expect(original).toContain('if ([host isEqualToString:@"::"]) host = nil;');
  expect(readFileSync(join(dependency, 'react-native-tcp-socket.podspec'), 'utf8'))
    .toContain('s.dependency "CocoaAsyncSocket", "7.6.5"');
});

it('fails closed when an upstream native upgrade removes a reviewed patch site', () => {
  expect(() => patchClient('unrecognized upstream socket implementation')).toThrow('source changed');
});

it('runs the Cocoa source patch within post_install exactly once and propagates failure', () => {
  const original = 'target "App" do\n  post_install do |installer|\n    react_native_post_install(installer)\n  end\nend';
  const patched = addTcpPunchHook(original);
  expect(addTcpPunchHook(patched)).toBe(patched);
  expect(patched.indexOf('patch-cocoa-tcp-punch.cjs')).toBeGreaterThan(patched.indexOf('post_install'));
  expect(patched).toContain("pod.pod_name == 'CocoaAsyncSocket'");
  expect(patched).toContain("raise 'CocoaAsyncSocket is missing from the resolved Pods.' unless socket_pod");
  expect(patched).toContain('installer.sandbox.root.to_s, socket_pod.root_spec.version.to_s, exception: true)');
  expect(() => addTcpPunchHook('different podfile')).toThrow('Podfile changes');
});

it('rejects missing or unreviewed Cocoa versions before touching installed sources', () => {
  for (const version of [undefined, '7.6.4', '7.6.6']) {
    expect(() => patchPods('unopened-pods-directory', version)).toThrow('Review iOS TCP port reuse');
  }
});
