const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
const buildTools = process.env.ANDROID_BUILD_TOOLS || '35.0.0';
const javaTool = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
const work = path.join(root, '.codex-tmp/tcp-punch-device');
const serial = process.env.ANDROID_SERIAL || 'emulator-5580';
const androidJar = path.join(sdk, 'platforms/android-35/android.jar');
fs.mkdirSync(work, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`${result.error || result.stderr || result.stdout}`);
  return result.stdout;
}
const sources = ['PunchSocket', 'PunchServer', 'PunchDescriptor']
  .map(name => path.join(root, `apps/native/patches/tcp/${name}.java`));
run(javaTool('javac'), ['-encoding', 'UTF-8', '-cp', androidJar, '-d', work,
  ...sources, path.join(root, 'apps/native/e2e/tcp/PunchSocketChecks.java')]);
const classes = [path.join(work, 'PunchSocketChecks.class'),
  ...fs.readdirSync(path.join(work, 'com/asterinet/react/tcpsocket')).filter(name => name.endsWith('.class'))
    .map(name => path.join(work, 'com/asterinet/react/tcpsocket', name))];
const jar = path.join(work, 'checks.jar');
run(javaTool('java'), ['-cp', path.join(sdk, 'build-tools', buildTools, 'lib/d8.jar'),
  'com.android.tools.r8.D8', '--lib', androidJar, '--output', jar, ...classes]);
const adb = path.join(sdk, 'platform-tools/adb');
const target = '/data/local/tmp/csw-tcp-punch-checks.jar';
try {
  run(adb, ['-s', serial, 'push', jar, target]);
  const output = run(adb, ['-s', serial, 'shell', `CLASSPATH=${target} app_process / PunchSocketChecks`]);
  if (!output.includes('TCP_REUSE_PASS')) throw new Error(output);
  console.log(output.trim());
} finally { run(adb, ['-s', serial, 'shell', 'rm', '-f', target]); }
