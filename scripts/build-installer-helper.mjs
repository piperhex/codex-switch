import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyWindowsRuntime } from "./verify-windows-runtime.mjs";

export const helperRoot = fileURLToPath(new URL("../apps/desktop/src-tauri/installer-helper/", import.meta.url));
const staticCrtFlags = ["-C", "target-feature=+crt-static"];

export function helperEnvironment(target, environment = process.env) {
  const env = { ...environment, CARGO_TARGET_DIR: join(helperRoot, "target") };
  // Cargo environment flags override .cargo/config.toml. Preserve them and enforce static CRT last.
  if (env.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    const flags = env.CARGO_ENCODED_RUSTFLAGS ? [env.CARGO_ENCODED_RUSTFLAGS] : [];
    env.CARGO_ENCODED_RUSTFLAGS = [...flags, ...staticCrtFlags].join("\x1f");
  } else if (env.RUSTFLAGS !== undefined) {
    env.RUSTFLAGS = `${env.RUSTFLAGS} ${staticCrtFlags.join(" ")}`.trim();
  } else {
    const key = `CARGO_TARGET_${target.replaceAll("-", "_").toUpperCase()}_RUSTFLAGS`;
    if (env[key] !== undefined) env[key] = `${env[key]} ${staticCrtFlags.join(" ")}`.trim();
  }
  return env;
}

export function helperHostTarget() {
  const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (result.error) throw result.error;
  const target = result.stdout?.match(/^host: (.+)$/m)?.[1].trim();
  if (result.status !== 0 || !target?.endsWith("-pc-windows-msvc")) {
    throw new Error("The installer helper requires a Windows MSVC Rust toolchain.");
  }
  return target;
}

export function runHelperCargo(args, target) {
  const result = spawnSync("cargo", args, {
    cwd: helperRoot,
    env: helperEnvironment(target),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function buildInstallerHelper({ target = helperHostTarget(), release = true } = {}) {
  if (!/^(x86_64|aarch64|i686)-pc-windows-msvc$/.test(target)) {
    throw new Error(`Unsupported installer helper target: ${target}`);
  }
  runHelperCargo(["build", "--locked", "--target", target, ...(release ? ["--release"] : [])], target);
  const executable = join(helperRoot, "target", target, release ? "release" : "debug", "csw-installer-helper.exe");
  verifyWindowsRuntime(executable);
  return executable;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const targetIndex = args.indexOf("--target");
  const target = targetIndex >= 0 ? args.splice(targetIndex, 2)[1] : undefined;
  if ((targetIndex >= 0 && !target) || args.some((arg) => arg !== "--debug")) {
    throw new Error("Usage: node scripts/build-installer-helper.mjs [--target <MSVC target>] [--debug]");
  }
  buildInstallerHelper({ target, release: !args.includes("--debug") });
}
