const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { patchCocoaDirectory } = require('./patch-cocoa-tcp-punch.cjs');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.codex-tmp/ios-tcp-native-checks');
const version = '7.6.5';
function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function sources() {
  fs.mkdirSync(output, { recursive: true });
  for (const file of ['GCDAsyncSocket.h', 'GCDAsyncSocket.m']) {
    const url = `https://raw.githubusercontent.com/robbiehanson/CocoaAsyncSocket/${version}/Source/GCD/${file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`CocoaAsyncSocket download failed (${response.status})`);
    fs.writeFileSync(path.join(output, file), await response.text());
  }
  patchCocoaDirectory(output);
}

function compile(sdk, executable) {
  const platform = sdk === 'iphonesimulator' ? 'ios15.1-simulator' : 'macos12.0';
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  run('xcrun', ['--sdk', sdk, 'clang', '-fobjc-arc', '-fmodules', '-Werror=implicit-function-declaration',
    '-target', `${architecture}-apple-${platform}`, '-isysroot', run('xcrun', ['--sdk', sdk, '--show-sdk-path']).trim(),
    '-framework', 'Foundation', '-framework', 'Security', '-framework', 'CFNetwork', '-I', output,
    path.join(output, 'GCDAsyncSocket.m'), 'apps/native/e2e/tcp/IosTcpPunchChecks.m', '-o', executable]);
}

function simulator() {
  const { devices } = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
  const available = Object.entries(devices).filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, values]) => values).filter(device => device.name.startsWith('iPhone'));
  const device = available.find(item => item.state === 'Booted') ?? available[0];
  if (!device) throw new Error('An available iOS simulator is required for the native TCP check.');
  const bootedHere = device.state !== 'Booted';
  if (bootedHere) run('xcrun', ['simctl', 'boot', device.udid]);
  try {
    run('xcrun', ['simctl', 'bootstatus', device.udid, '-b']);
    const executable = path.join(output, 'tcp-punch-ios');
    compile('iphonesimulator', executable);
    return run('xcrun', ['simctl', 'spawn', device.udid, executable]);
  } finally {
    if (bootedHere) run('xcrun', ['simctl', 'shutdown', device.udid]);
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Run this native check on macOS with Xcode installed.');
  await sources();
  const executable = path.join(output, 'tcp-punch-macos');
  compile('macosx', executable);
  for (const result of [run(executable, []), simulator()]) {
    if (!result.includes('IOS_TCP_PUNCH_PASS')) throw new Error(result);
    console.log(result.trim());
  }
}
main().catch(error => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
