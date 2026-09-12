import { readFileSync, writeFileSync } from "node:fs";
import { buildInstallerHelper } from "./build-installer-helper.mjs";
import { packagedExecutable } from "./verify-tauri-assets.mjs";

if (process.platform === "win32") {
  const bytes = readFileSync(packagedExecutable);
  const peOffset = bytes.readUInt32LE(0x3c);
  const targets = new Map([
    [0x8664, "x86_64-pc-windows-msvc"],
    [0xaa64, "aarch64-pc-windows-msvc"],
    [0x014c, "i686-pc-windows-msvc"],
  ]);
  const target = targets.get(bytes.readUInt16LE(peOffset + 4));
  if (!target) throw new Error("Unsupported Windows application architecture.");
  const helper = buildInstallerHelper({ target }).replaceAll("$", "$$");
  writeFileSync(new URL("../apps/desktop/src-tauri/target/installer-helper-path.nsh", import.meta.url),
    `!define CSW_HELPER_PATH "${helper}"\n`);
}
