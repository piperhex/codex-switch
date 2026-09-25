const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RELEASE_ARCHITECTURES } = require('./verify-apk.cjs');

const nativeDirectory = path.resolve(__dirname, '..');
const androidDirectory = path.join(nativeDirectory, 'android');
const nativeModulesDirectory = path.join(nativeDirectory, 'node_modules');
const expoScript = path.join(__dirname, 'expo.cjs');
const apkPath = path.join(androidDirectory, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const nodePath = [nativeModulesDirectory, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
const buildEnvironment = { ...process.env, NODE_ENV: 'production', NODE_PATH: nodePath };
const isWindows = process.platform === 'win32';
const gradleCommand = isWindows ? process.env.ComSpec ?? 'cmd.exe' : 'sh';
// Prebuild only cleans the app. Dependency JNI copy tasks can retain emulator-only outputs after an ABI change.
const releaseArguments = [
  'assembleRelease', '--no-daemon', '--no-build-cache', '--rerun-tasks',
  `-PreactNativeArchitectures=${RELEASE_ARCHITECTURES.join(',')}`,
];
const gradleArguments = isWindows
  ? ['/d', '/s', '/c', `gradlew.bat ${releaseArguments.join(' ')}`]
  : ['./gradlew', ...releaseArguments];

function runBuildStep(command, argumentsList, workingDirectory) {
  const result = spawnSync(command, argumentsList, {
    cwd: workingDirectory,
    env: buildEnvironment,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Unable to start ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runBuildStep(
  process.execPath,
  [expoScript, 'prebuild', '--platform', 'android', '--clean', '--no-install'],
  nativeDirectory,
);
runBuildStep(gradleCommand, gradleArguments, androidDirectory);
runBuildStep(process.execPath, [path.join(__dirname, 'verify-apk.cjs'), apkPath], nativeDirectory);

console.log(`Android APK created at ${apkPath}`);
