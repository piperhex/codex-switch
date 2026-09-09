import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// This crate uses Windows APIs directly; other platforms do not package it.
if (process.platform === "win32") {
  const cwd = fileURLToPath(new URL("../apps/desktop/src-tauri/installer-helper/", import.meta.url));
  for (const args of [
    ["fmt", "--", "--check"],
    ["clippy", "--locked", "--all-targets", "--", "-D", "warnings"],
    ["test", "--locked", "--", "--test-threads=1"],
  ]) {
    const result = spawnSync("cargo", args, { cwd, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
