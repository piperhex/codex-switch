import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const desktopRoot = join(repositoryRoot, "apps", "desktop");
const tauriRoot = join(desktopRoot, "src-tauri");
const cargoManifest = join(tauriRoot, "Cargo.toml");
const tauriCli = join(repositoryRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const tauriArgs = process.argv.slice(2);

if (!existsSync(tauriCli)) {
  fail("Tauri CLI is unavailable. Run `npm ci` or `npm install` first.");
}

// A normal `cargo build --release` and `tauri build` use different Tauri
// features but write to the same top-level executable. Cargo can regard the
// custom-protocol artifact as fresh while the top-level executable was most
// recently overwritten by the normal build. Cleaning this package's release
// artifacts forces Tauri to relink the executable without recompiling every
// dependency.
console.log("Preparing a clean Tauri release executable...");
run("cargo", [
  "clean",
  "--manifest-path",
  cargoManifest,
  "--release",
  "--package",
  "csw",
]);

if (
  !process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()
  && !tauriArgs.includes("--no-sign")
) {
  console.log(
    "TAURI_SIGNING_PRIVATE_KEY is not set; building unsigned local installers.",
  );
  tauriArgs.push("--no-sign");
}

run(process.execPath, [tauriCli, "build", ...tauriArgs], desktopRoot);

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`Unable to run ${command}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
