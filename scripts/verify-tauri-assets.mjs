import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const desktopRoot = join(repositoryRoot, "apps", "desktop");
const tauriRoot = join(desktopRoot, "src-tauri");
const baseConfig = JSON.parse(readFileSync(join(tauriRoot, "tauri.conf.json"), "utf8"));
const buildConfig = JSON.parse(process.env.TAURI_CONFIG || "{}").build;
const distRoot = resolve(tauriRoot, buildConfig?.frontendDist ?? baseConfig.build.frontendDist);
const indexPath = join(distRoot, "index.html");
const cargoTargetRoot = resolveCargoTargetRoot();

if (!existsSync(indexPath)) {
  fail(`Frontend entry point is missing: ${relative(repositoryRoot, indexPath)}`);
}

const indexHtml = readFileSync(indexPath, "utf8");
const embeddedAssetNames = [
  ...indexHtml.matchAll(
    /(?:src|href)=["'][^"']*\/([^/"']+\.(?:js|css))["']/gi,
  ),
].map((match) => match[1]);

if (embeddedAssetNames.length === 0) {
  fail("Frontend entry point does not reference any JavaScript or CSS assets.");
}

const executableNames =
  process.platform === "win32"
    ? new Set(["csw.exe"])
    : new Set(["csw"]);
const executableCandidates = findFiles(
  cargoTargetRoot,
  (path) =>
    executableNames.has(basename(path))
    && basename(dirname(path)) === "release",
);

if (executableCandidates.length === 0) {
  fail(
    `Unable to find the packaged application executable under ${relative(repositoryRoot, cargoTargetRoot)}.`,
  );
}

const packagedExecutable = executableCandidates.sort(
  (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
)[0];

const executable = readFileSync(packagedExecutable);
const missingAssetNames = embeddedAssetNames.filter((name) => !executable.includes(Buffer.from(name)));
if (missingAssetNames.length > 0) {
  fail(
    [
      `Executable ${relative(repositoryRoot, packagedExecutable)} is missing: ${missingAssetNames.join(", ")}.`,
      `Expected assets from ${relative(repositoryRoot, indexPath)}.`,
      "The executable or frontend output may have been replaced by another build.",
      "Use `npm run build:app` and avoid concurrent builds of the same release executable.",
    ].join(" "),
  );
}

console.log(
  `Verified ${embeddedAssetNames.length} embedded frontend assets in ${relative(repositoryRoot, packagedExecutable)}.`,
);

function resolveCargoTargetRoot() {
  const configured = process.env.CARGO_TARGET_DIR?.trim();
  if (!configured) {
    return join(desktopRoot, "src-tauri", "target");
  }
  return isAbsolute(configured)
    ? configured
    : resolve(desktopRoot, "src-tauri", configured);
}

function findFiles(root, predicate) {
  if (!existsSync(root)) return [];
  const matches = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && predicate(path)) {
        matches.push(path);
      }
    }
  }

  return matches;
}

function fail(message) {
  console.error(`Tauri asset verification failed: ${message}`);
  process.exit(1);
}
