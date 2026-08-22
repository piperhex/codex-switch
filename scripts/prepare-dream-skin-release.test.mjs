import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDirectory, "prepare-dream-skin-release.mjs");

test("prepares every registered Dream Skin preset", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "codex-switch-dream-skin-"));
  const outputRoot = join(temporaryRoot, "release");

  try {
    const output = execFileSync(process.execPath, [scriptPath, outputRoot], {
      encoding: "utf8",
    });
    const presetDirectories = readdirSync(join(outputRoot, "presets"));

    assert.match(output, /Prepared 173 Dream Skin themes/);
    assert.equal(presetDirectories.length, 173);
    assert.equal(existsSync(join(outputRoot, "LICENSE")), true);
    assert.equal(existsSync(join(outputRoot, "NOTICE.md")), true);
    assert.equal(existsSync(join(outputRoot, "SOURCES.json")), true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
