import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

it('generates iOS desktop permissions and rotation support after all Expo plugins run', () => {
  const output = execFileSync(process.execPath, ['scripts/expo.cjs', 'config', '--type', 'introspect', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const config = JSON.parse(output) as {
    _internal: { modResults: { ios: { infoPlist: Record<string, unknown> } } };
    plugins: Array<string | [string, unknown]>;
  };
  const plist = config._internal.modResults.ios.infoPlist;
  expect(plist.NSLocalNetworkUsageDescription).toContain('远程桌面');
  // WebRTC's plugin restores this permission if our receive-only configuration runs too early.
  expect(plist).not.toHaveProperty('NSMicrophoneUsageDescription');
  expect(plist.NSCameraUsageDescription).toContain('扫描二维码');
  expect(plist.UIRequiresFullScreen).toBe(true);
  expect(plist.UISupportedInterfaceOrientations).toEqual(expect.arrayContaining([
    'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
  ]));
  expect(config.plugins.map(plugin => typeof plugin === 'string' ? plugin : plugin[0]))
    .toContain('@config-plugins/react-native-webrtc');
}, 35_000);

it('links the native iOS WebRTC renderer and safe-area pods into the generated app', () => {
  const require = createRequire(import.meta.url);
  const linking = dirname(require.resolve('expo-modules-autolinking/package.json'));
  const output = execFileSync(process.execPath, [join(linking, 'bin/expo-modules-autolinking.js'),
    'react-native-config', '--platform', 'ios', '--project-root', root, '--json'],
  { cwd: root, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const config = JSON.parse(output) as {
    dependencies: Record<string, { platforms: { ios?: { podspecPath: string } } }>;
  };
  for (const name of ['react-native-webrtc', 'react-native-safe-area-context']) {
    const podspec = config.dependencies[name]?.platforms.ios?.podspecPath;
    expect(podspec).toBeTruthy();
    expect(existsSync(podspec!)).toBe(true);
  }
}, 25_000);
