import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  const root = fileURLToPath(new URL("../apps/desktop/src-tauri/installer-helper/", import.meta.url));
  const result = spawnSync("cargo", ["build", "--locked", "--release", "--target", target], {
    cwd: root,
    // The helper uses a separate target directory, including when the application overrides its own.
    env: { ...process.env, CARGO_TARGET_DIR: `${root}target` },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const helper = join(root, "target", target, "release", "csw-installer-helper.exe").replaceAll("$", "$$");
  writeFileSync(new URL("../apps/desktop/src-tauri/target/installer-helper-path.nsh", import.meta.url),
    `!define CSW_HELPER_PATH "${helper}"\n`);
}
