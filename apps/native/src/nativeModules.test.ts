import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const autolinkingRoot = dirname(require.resolve('expo-modules-autolinking/package.json'));

it('registers native file, image, document picker and icon services used by chat attachments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-switch-native-modules-'));
  const target = join(directory, 'ExpoModulesPackageList.java');
  try {
    // A JS mock cannot detect missing native packages in a release APK.
    execFileSync(process.execPath, [join(autolinkingRoot, 'bin/expo-modules-autolinking.js'),
      'generate-package-list', '--platform', 'android', '--project-root', projectRoot,
      '--namespace', 'expo.modules', '--target', target], { timeout: 20_000, stdio: 'pipe' });
    const packages = readFileSync(target, 'utf8');
    expect(packages).toContain('new expo.modules.filesystem.FileSystemPackage()');
    expect(packages).toContain('new expo.modules.imageloader.ImageLoaderPackage()');
    expect(packages).toContain('expo.modules.imagepicker.ImagePickerModule.class');
    expect(packages).toContain('expo.modules.imagemanipulator.ImageManipulatorModule.class');
    expect(packages).toContain('expo.modules.documentpicker.DocumentPickerModule.class');
    expect(packages).toContain('expo.modules.font.FontLoaderModule.class');
    expect(packages).toContain('expo.modules.medialibrary.MediaLibraryModule.class');
    expect(packages).toContain('expo.modules.screenorientation.ScreenOrientationModule.class');
    expect(packages).toContain('expo.modules.sensors.modules.AccelerometerModule.class');
  } finally {
    rmSync(target, { force: true });
    rmdirSync(directory);
  }
}, 30_000);
