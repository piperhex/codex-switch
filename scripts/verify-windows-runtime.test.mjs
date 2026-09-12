import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyWindowsRuntime, windowsImports } from "./verify-windows-runtime.mjs";

// Keep section RVAs different from disk offsets, as in real executables.
function executable({ is64 = true, imports = [], delayed = [] } = {}) {
  const bytes = Buffer.alloc(2048);
  bytes.write("MZ");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80);
  bytes.writeUInt16LE(1, 0x86);
  const optional = 0x98;
  const optionalSize = is64 ? 240 : 224;
  bytes.writeUInt16LE(optionalSize, 0x94);
  bytes.writeUInt16LE(is64 ? 0x20b : 0x10b, optional);
  bytes.writeUInt32LE(512, optional + 60);
  const directories = optional + (is64 ? 112 : 96);
  bytes.writeUInt32LE(16, directories - 4);
  const section = optional + optionalSize;
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(1536, section + 16);
  bytes.writeUInt32LE(512, section + 20);
  let nameOffset = 1200;
  for (const [names, directory, offset, size, field] of [
    [imports, 1, 512, 20, 12], [delayed, 13, 768, 32, 4],
  ]) {
    if (!names.length) continue;
    bytes.writeUInt32LE(0x1000 + offset - 512, directories + directory * 8);
    bytes.writeUInt32LE((names.length + 1) * size, directories + directory * 8 + 4);
    names.forEach((name, index) => {
      if (directory === 13) bytes.writeUInt32LE(1, offset + index * size);
      bytes.writeUInt32LE(0x1000 + nameOffset - 512, offset + index * size + field);
      nameOffset += bytes.write(`${name}\0`, nameOffset);
    });
  }
  return bytes;
}

function verifyFixture(context, bytes) {
  const root = mkdtempSync(join(tmpdir(), "windows-runtime-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "helper.exe");
  writeFileSync(path, bytes);
  return () => verifyWindowsRuntime(path);
}

test("reads imports from PE32 and PE32+ binaries", () => {
  for (const is64 of [false, true]) {
    const imports = ["KERNEL32.dll", "USER32.dll"];
    assert.deepEqual(windowsImports(executable({ is64, imports })), imports);
  }
});

test("allows supported Windows system DLLs", (context) => {
  const imports = ["KERNEL32.dll", "msvcp_win.dll", "ucrtbase.dll"];
  assert.deepEqual(verifyFixture(context, executable({ imports }))(), imports);
});

test("rejects direct VC runtime dependencies, including case and debug variants", (context) => {
  for (const name of ["VCRUNTIME140.dll", "vcruntime140_1.dll", "VCRUNTIME140D.DLL", "MSVCP140.dll"]) {
    assert.throws(verifyFixture(context, executable({ imports: ["KERNEL32.dll", name] })),
      /requires an external Visual C\+\+ runtime/);
  }
});

test("rejects delayed VC runtime dependencies", (context) => {
  assert.throws(verifyFixture(context, executable({ delayed: ["VCRUNTIME140.dll"] })), /VCRUNTIME140\.dll/);
});

test("rejects malformed and truncated executables instead of accepting missing imports", () => {
  assert.throws(() => windowsImports(Buffer.from("not an executable")), /header/);
  assert.throws(() => windowsImports(executable({ imports: ["KERNEL32.dll"] }).subarray(0, 520)));
  const bytes = executable({ imports: ["VCRUNTIME140.dll"] });
  bytes.writeUInt32LE(0xffff_ffff, 512 + 12);
  assert.throws(() => windowsImports(bytes), /Invalid PE import address/);
});
