import { readFileSync } from "node:fs";
import { buildInstallerHelper } from "./build-installer-helper.mjs";
import { packagedExecutable } from "./verify-tauri-assets.mjs";
import { verifyWindowsRuntime } from "./verify-windows-runtime.mjs";

if (process.platform === "win32") {
  verifyWindowsRuntime(packagedExecutable);
  // MSI still needs its embedded shutdown guard. NSIS calls Windows APIs directly
  // and never embeds or executes this binary.
  const bytes = readFileSync(packagedExecutable);
  const peOffset = bytes.readUInt32LE(0x3c);
  const targets = new Map([
    [0x8664, "x86_64-pc-windows-msvc"],
    [0xaa64, "aarch64-pc-windows-msvc"],
    [0x014c, "i686-pc-windows-msvc"],
  ]);
  const target = targets.get(bytes.readUInt16LE(peOffset + 4));
  if (!target) throw new Error("Unsupported Windows application architecture.");
  buildInstallerHelper({ target });
}
