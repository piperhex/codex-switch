import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tauriRoot = fileURLToPath(new URL("../apps/desktop/src-tauri/", import.meta.url));
const executableMode = 0o755;
const downloadTimeoutMs = 60_000;
const launcherBaseUrl = "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old";
const launcherHashes = {
  x86_64: "f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f",
  aarch64: "072f17c0895a85c490282fe5395c5007e5fc75da727e553b3b8fb680feb11578",
  i686: "a573a682b1a4a3e9b5dddbd1f5785749b7bba6013149b51ae99d0f123fe11691",
  armhf: "b14d89f0762bcf09fc6af2359d936675928b8833ff52a1aeda68cb28a309f6ba",
};

function launcherArchitecture() {
  const arch = process.env.TAURI_ENV_ARCH || process.arch;
  return { x64: "x86_64", arm64: "aarch64", x86: "i686", ia32: "i686", arm: "armhf" }[arch] || arch;
}

function launcherCacheDirectory() {
  // Match Tauri's cargo metadata lookup, including .cargo/config.toml overrides.
  const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
    cwd: tauriRoot,
    encoding: "utf8",
    timeout: 30_000,
  }));
  return join(metadata.target_directory, ".tauri");
}

// tauri.linux.conf.json uses target/.tauri so the hook and bundler share a cache.
// Tauri CLI 2.11.4 otherwise downloads AppRun with mode 0770 and copies that mode
// into AppRun.wrapped. Prepare it before bundling/signing, including on a cold cache.
export async function prepareLinuxAppImage({
  cacheDirectory = launcherCacheDirectory(),
  arch = launcherArchitecture(),
  download = fetch,
} = {}) {
  const expectedHash = launcherHashes[arch];
  if (!expectedHash) throw new Error(`Unsupported AppImage launcher architecture: ${arch}`);
  const launcher = join(cacheDirectory, `AppRun-${arch}`);
  let bytes;
  if (existsSync(launcher)) {
    bytes = readFileSync(launcher);
  } else {
    const response = await download(`${launcherBaseUrl}/AppRun-${arch}`, {
      signal: AbortSignal.timeout(downloadTimeoutMs),
    });
    if (!response.ok) throw new Error(`AppImage launcher download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  installAppImageLauncher({ launcher, bytes, expectedHash });
  console.log(`Prepared AppImage launcher ${arch} with mode 0755.`);
}

export function installAppImageLauncher({ launcher, bytes, expectedHash }) {
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) throw new Error("AppImage launcher checksum mismatch.");
  mkdirSync(dirname(launcher), { recursive: true });
  if (!existsSync(launcher)) writeFileSync(launcher, bytes, { mode: executableMode });
  chmodSync(launcher, executableMode);
}
