import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWindowsRuntime } from './verify-windows-runtime.mjs';

const source = fileURLToPath(new URL('../apps/desktop/src-tauri/desktop-video/', import.meta.url));

export function buildDesktopVideo({ sdk, cache, destination }) {
  const directory = resolve(cache, 'native-build');
  run('cmake', ['-S', source, '-B', directory, '-G', 'Visual Studio 17 2022', '-A', 'x64',
    '-DCMAKE_SYSTEM_VERSION=10.0.26100.0', `-DFFMPEG_SDK=${sdk}`, `-DVIDEO_OUTPUT=${destination}`]);
  run('cmake', ['--build', directory, '--config', 'Release', '--parallel']);
  run('ctest', ['--test-dir', directory, '-C', 'Release', '--output-on-failure']);
  verifyWindowsRuntime(resolve(destination, 'desktop-video.exe'));
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Desktop video build failed: ${command}`);
}
