import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyWindowsRuntime } from "./verify-windows-runtime.mjs";

const fixtureRoot = fileURLToPath(new URL("./installer-fixture/", import.meta.url));
const usage = "Usage: node scripts/check-installer-fixture.mjs [--target <MSVC target>]";

function fixtureTarget() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--target")) throw new Error(usage);
  if (args.length) return args[1];
  const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (result.error) throw result.error;
  const target = result.stdout?.match(/^host: (.+)$/m)?.[1].trim();
  if (result.status !== 0 || !target) throw new Error("Cannot determine the Rust host target.");
  return target;
}

function checkFixture() {
  const target = fixtureTarget();
  if (!/^(x86_64|aarch64|i686)-pc-windows-msvc$/.test(target)) {
    throw new Error(`Unsupported Windows installer fixture target: ${target}`);
  }
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: join(fixtureRoot, "target"),
    // A dependency-free fixture has its own flags; ambient application flags must not enable dynamic CRT.
    CARGO_ENCODED_RUSTFLAGS: "-C\x1ftarget-feature=+crt-static",
  };
  for (const args of [
    ["fmt", "--", "--check"],
    ["clippy", "--locked", "--offline", "--all-targets", "--target", target, "--", "-D", "warnings"],
    ["build", "--locked", "--offline", "--target", target],
  ]) {
    const result = spawnSync("cargo", args, { cwd: fixtureRoot, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const executable = join(fixtureRoot, "target", target, "debug", "csw-installer-fixture.exe");
  verifyWindowsRuntime(executable);
  console.log(`Installer fixture: ${executable}`);
}

if (process.platform === "win32") checkFixture();
