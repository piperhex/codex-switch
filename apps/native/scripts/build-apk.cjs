const path = require('node:path');
const { spawnSync } = require('node:child_process');

const nativeDirectory = path.resolve(__dirname, '..');
const androidDirectory = path.join(nativeDirectory, 'android');
const nativeModulesDirectory = path.join(nativeDirectory, 'node_modules');
const expoScript = path.join(__dirname, 'expo.cjs');
const apkPath = path.join(androidDirectory, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const nodePath = [nativeModulesDirectory, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
const buildEnvironment = { ...process.env, NODE_ENV: 'production', NODE_PATH: nodePath };
const isWindows = process.platform === 'win32';
const gradleCommand = isWindows ? process.env.ComSpec ?? 'cmd.exe' : 'sh';
const gradleArguments = isWindows
  ? ['/d', '/s', '/c', 'gradlew.bat assembleRelease --no-daemon']
  : ['./gradlew', 'assembleRelease', '--no-daemon'];

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

console.log(`Android APK created at ${apkPath}`);
