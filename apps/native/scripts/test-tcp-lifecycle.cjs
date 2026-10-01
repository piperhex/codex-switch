const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyTcpPunchPatch } = require('./patch-tcp-punch.cjs');

const native = path.resolve(__dirname, '..');
const dependency = path.dirname(require.resolve('react-native-tcp-socket/package.json', { paths: [native] }));
const source = process.argv[2] || path.join(dependency, 'android/src/main/java/com/asterinet/react/tcpsocket');
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
const androidJar = path.join(sdk, 'platforms/android-35/android.jar');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-tcp-lifecycle-'));
const executable = name => process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
const run = (name, args) => execFileSync(executable(name), args,
  { stdio: 'inherit', windowsHide: true, timeout: 30_000 });

try {
  if (!process.argv[2]) applyTcpPunchPatch();
  const stubs = require('../e2e/tcp/lifecycleStubs.cjs');
  const sources = Object.entries(stubs).map(([name, content]) => {
    const file = path.join(output, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  });
  for (const name of ['TcpSocket', 'TcpSocketModule', 'TcpSocketClient', 'TcpSocketServer',
    'KeystoreInfo', 'ResolvableOption', 'PunchSocket', 'PunchServer', 'PunchDescriptor']) {
    sources.push(path.join(source, name + '.java'));
  }
  sources.push(path.join(native, 'e2e/tcp/TcpLifecycleChecks.java'));
  run('javac', ['-encoding', 'UTF-8', '-cp', androidJar, '-d', output, ...sources]);
  run('java', ['-cp', [output, androidJar].join(path.delimiter),
    'com.asterinet.react.tcpsocket.TcpLifecycleChecks']);
} finally {
  const resolved = fs.realpathSync(output);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir())) throw new Error('Unexpected test output directory');
  fs.rmSync(resolved, { recursive: true, force: true });
}
