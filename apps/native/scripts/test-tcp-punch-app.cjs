const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const native = path.join(root, 'apps/native'), android = path.join(native, 'android');
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
const adb = path.join(sdk, 'platform-tools/adb');
const serial = process.env.ANDROID_SERIAL || 'emulator-5580';
if (!serial.startsWith('emulator-')) throw new Error('This isolated app test requires an emulator.');
const appId = 'com.codexswitch.tcppunchchecks';
const buildFile = path.join(android, 'app/build.gradle'), original = fs.readFileSync(buildFile);
const apk = path.join(android, 'app/build/outputs/apk/release/app-release.apk');
const output = path.join(root, '.codex-tmp/tcp-punch-app');
fs.mkdirSync(output, { recursive: true });
const previousApk = fs.existsSync(apk) ? path.join(output, 'regular-app.apk') : undefined;
if (previousApk) fs.copyFileSync(apk, previousApk);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024, timeout: 300_000,
    env: { ...process.env, NODE_ENV: 'production', NODE_PATH: path.join(native, 'node_modules') } });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}: ${result.error || result.stderr || result.stdout}`);
  }
  return result.stdout;
}
const device = (...args) => run(adb, ['-s', serial, ...args]);
async function main() {
  try {
    const entry = path.join(native, 'e2e/tcpPunchChecks.tsx').replaceAll('\\', '/');
    const changed = original.toString().replace(/^\s*entryFile = file\(.*\)$/m, `    entryFile = file('${entry}')`)
      .replace("applicationId 'com.codexswitch.mobile'", `applicationId '${appId}'`);
    if (!changed.includes(`entryFile = file('${entry}')`) || !changed.includes(`applicationId '${appId}'`)) {
      throw new Error('Review generated Gradle configuration before running the fixture.');
    }
    fs.writeFileSync(buildFile, changed);
    console.log('Building isolated TCP fixture APK');
    const build = process.platform === 'win32'
      ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat :app:assembleRelease --no-daemon'], android)
      : run('./gradlew', [':app:assembleRelease', '--no-daemon'], android);
    fs.writeFileSync(path.join(output, 'build.log'), build);
    fs.copyFileSync(apk, path.join(output, 'fixture.apk'));
    console.log(device('install', '-r', apk).trim());
    console.log(device('shell', 'am', 'start', '-W', '-n', `${appId}/com.codexswitch.mobile.MainActivity`).trim());
    for (let count = 0; count < 40; count++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pid = device('shell', 'pidof', appId).trim();
      const logs = device('logcat', '-d', '--pid', pid, '-s', 'ReactNativeJS');
      fs.writeFileSync(path.join(output, 'device.log'), logs);
      if (logs.includes('TCP_PUNCH_ERROR')) throw new Error(logs);
      if (logs.includes('TCP_PUNCH_RESULT')) { console.log(logs.trim()); return; }
    }
    throw new Error('TCP fixture did not complete');
  } finally {
    fs.writeFileSync(buildFile, original);
    if (previousApk) fs.copyFileSync(previousApk, apk);
    device('uninstall', appId);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
