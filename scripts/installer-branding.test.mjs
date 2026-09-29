import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const compiler = join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS', 'makensis.exe');
const available = process.platform === 'win32' && existsSync(compiler);

test('renamed installers reuse legacy installs and retire registration only after success', {
  skip: !available,
}, () => {
  const scratch = resolve('.codex-tmp');
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, 'installer-branding-'));
  const name = `CodexRemoteTest-${Date.now()}`;
  const registry = `Software\\${name}`;
  const uninstall = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}-legacy`;
  const output = join(directory, 'fixture.exe');
  const source = join(directory, 'fixture.nsi');
  writeFileSync(source, fixtureSource({ directory, name, registry, output }));
  const compiled = spawnSync(compiler, ['/V2', source], { encoding: 'utf8', windowsHide: true });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  try {
    const result = spawnSync(output, ['/S'], { windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 0, result.error?.message);
  } finally {
    // These keys are unique to this fixture; no installed application is touched.
    for (const key of [registry, uninstall]) {
      spawnSync('reg.exe', ['delete', `HKCU\\${key}`, '/f'], { windowsHide: true, stdio: 'ignore' });
    }
  }
});

function fixtureSource({ directory, name, registry, output }) {
  const values = { directory, name, registry, output,
    branding: resolve('apps/desktop/src-tauri/windows/installer-branding.nsh') };
  return readFileSync(new URL('./installer-fixture/branding.nsi', import.meta.url), 'utf8')
    .replace(/@(\w+)@/g, (_, key) => values[key]);
}
