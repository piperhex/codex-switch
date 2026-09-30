import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { installAppImageLauncher, prepareLinuxAppImage } from "./prepare-linux-appimage.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "appimage-launcher-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("verified launcher fixture");
  return {
    launcher: join(directory, "AppRun-x86_64"),
    bytes,
    expectedHash: createHash("sha256").update(bytes).digest("hex"),
  };
}

function assertExecutable(launcher) {
  if (process.platform !== "win32") assert.equal(statSync(launcher).mode & 0o777, 0o755);
}

test("a cold cache installs a verified launcher readable and executable by other users", (context) => {
  const input = fixture(context);
  installAppImageLauncher(input);
  assert.deepEqual(readFileSync(input.launcher), input.bytes);
  assertExecutable(input.launcher);
});

test("repairs an existing 0770 launcher without changing its contents", (context) => {
  const input = fixture(context);
  writeFileSync(input.launcher, input.bytes);
  chmodSync(input.launcher, 0o770);
  installAppImageLauncher(input);
  assert.deepEqual(readFileSync(input.launcher), input.bytes);
  assertExecutable(input.launcher);
});

test("rejects corrupt downloads before putting them in the bundler cache", (context) => {
  const input = fixture(context);
  assert.throws(() => installAppImageLauncher({ ...input, bytes: Buffer.from("corrupt") }), /checksum/);
  assert.equal(existsSync(input.launcher), false);
});

test("a failed download stops packaging instead of leaving a partial launcher", async (context) => {
  const input = fixture(context);
  await assert.rejects(prepareLinuxAppImage({
    cacheDirectory: dirname(input.launcher),
    arch: "x86_64",
    download: async () => ({ ok: false, status: 503 }),
  }), /HTTP 503/);
  assert.equal(existsSync(input.launcher), false);
});

test("rejects unsupported launcher architectures before downloading", async (context) => {
  const input = fixture(context);
  await assert.rejects(prepareLinuxAppImage({
    cacheDirectory: dirname(input.launcher), arch: "unsupported",
  }), /Unsupported/);
});
