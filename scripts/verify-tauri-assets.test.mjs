import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const verifier = new URL("./verify-tauri-assets.mjs", import.meta.url);
const executableName = process.platform === "win32" ? "csw.exe" : "csw";

function createFixture(context) {
  const root = mkdtempSync(join(tmpdir(), "tauri-assets-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, "scripts", "verify-tauri-assets.mjs");
  const desktop = join(root, "apps", "desktop");
  const tauri = join(desktop, "src-tauri");
  const target = join(tauri, "target");
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(tauri, { recursive: true });
  copyFileSync(verifier, script);
  writeFileSync(join(tauri, "tauri.conf.json"), JSON.stringify({ build: { frontendDist: "../dist" } }));
  return { script, desktop, tauri, target };
}

function writeAssets(directory, suffix) {
  mkdirSync(directory, { recursive: true });
  const names = [`index-${suffix}.js`, `index-${suffix}.css`];
  writeFileSync(join(directory, "index.html"),
    `<script src="/assets/${names[0]}"></script><link href="/assets/${names[1]}" rel="stylesheet">`);
  return names;
}

function writeExecutable(fixture, names) {
  const release = join(fixture.target, "release");
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, executableName), Buffer.from(names.join("\0")));
}

function verify(fixture, config = {}) {
  return spawnSync(process.execPath, [fixture.script], {
    cwd: fixture.desktop,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: fixture.target, TAURI_CONFIG: JSON.stringify(config) },
  });
}

test("verifies the frontendDist from the base Tauri configuration", (context) => {
  const fixture = createFixture(context);
  writeExecutable(fixture, writeAssets(join(fixture.desktop, "dist"), "default"));
  const result = verify(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 2 embedded frontend assets/);
});

test("packaging uses isolated assets even when another build replaces dist", (context) => {
  const fixture = createFixture(context);
  const frontendDist = "target/frontend-dist";
  writeExecutable(fixture, writeAssets(join(fixture.tauri, frontendDist), "packaged"));
  writeAssets(join(fixture.desktop, "dist"), "concurrent-build");
  const result = verify(fixture, { build: { frontendDist } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 2 embedded frontend assets/);
});

test("rejects a stale executable and identifies the missing assets and source", (context) => {
  const fixture = createFixture(context);
  const frontendDist = "target/frontend-dist";
  writeAssets(join(fixture.tauri, frontendDist), "current");
  writeExecutable(fixture, ["index-old.js", "index-old.css"]);
  const result = verify(fixture, { build: { frontendDist } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: index-current.js, index-current.css/);
  assert.match(result.stderr, /frontend-dist[/\\]index.html/);
});

test("rejects an executable containing only part of the required assets", (context) => {
  const fixture = createFixture(context);
  const names = writeAssets(join(fixture.desktop, "dist"), "partial");
  writeExecutable(fixture, [names[0]]);
  const result = verify(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: index-partial.css/);
});

test("does not fall back to dist when the configured frontend is missing", (context) => {
  const fixture = createFixture(context);
  writeExecutable(fixture, writeAssets(join(fixture.desktop, "dist"), "default"));
  const result = verify(fixture, { build: { frontendDist: "target/missing-frontend" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Frontend entry point is missing/);
});
