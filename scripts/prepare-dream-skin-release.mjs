import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const outputRoot = process.argv[2] ? resolve(process.argv[2]) : null;

if (!outputRoot) {
  throw new Error("Usage: node scripts/prepare-dream-skin-release.mjs <empty-output-directory>");
}
if (existsSync(outputRoot)) {
  throw new Error(`Output directory already exists: ${outputRoot}`);
}

const nativeSource = readFileSync(
  join(
    repositoryRoot,
    "apps",
    "desktop",
    "src-tauri",
    "src",
    "dream_skin_native",
    "types.rs",
  ),
  "utf8",
);
const registry = nativeSource.match(
  /pub\(crate\) const BUILT_IN_THEME_IDS: \[&str; \d+\] = \[(?<body>[\s\S]*?)\n\];/,
);
if (!registry?.groups?.body) {
  throw new Error("Unable to read the built-in Dream Skin registry");
}
const themeIds = [...registry.groups.body.matchAll(/"([a-z0-9_-]+)"/g)].map(
  (match) => match[1],
);
if (themeIds.length === 0 || new Set(themeIds).size !== themeIds.length) {
  throw new Error("The built-in Dream Skin registry is empty or contains duplicate ids");
}

const frontendIds = ["dreamSkinBuiltIns.ts", "dreamSkinGeneratedBuiltIns.ts"].flatMap(
  (fileName) => {
    const source = readFileSync(
      join(repositoryRoot, "apps", "desktop", "src", fileName),
      "utf8",
    );
    return [...source.matchAll(/\bid:\s*"([a-z0-9_-]+)"/g)].map((match) => match[1]);
  },
);
const nativeIdSet = new Set(themeIds);
const frontendIdSet = new Set(frontendIds);
if (
  frontendIds.length !== frontendIdSet.size
  || frontendIdSet.size !== nativeIdSet.size
  || [...frontendIdSet].some((themeId) => !nativeIdSet.has(themeId))
) {
  throw new Error("The Rust and frontend built-in Dream Skin registries do not match");
}

const presetsSource = join(
  repositoryRoot,
  "apps",
  "desktop",
  "src-tauri",
  "resources",
  "dream-skin",
  "presets",
);
const reproducibleTimestamp = new Date("2000-01-01T00:00:00.000Z");
let fileCount = 0;

for (const [source, fileName] of [
  [join(presetsSource, "..", "LICENSE"), "LICENSE"],
  [join(presetsSource, "..", "NOTICE.md"), "NOTICE.md"],
  [join(presetsSource, "SOURCES.json"), "SOURCES.json"],
]) {
  mkdirSync(outputRoot, { recursive: true });
  const destination = join(outputRoot, fileName);
  copyFileSync(source, destination);
  utimesSync(destination, reproducibleTimestamp, reproducibleTimestamp);
  fileCount += 1;
}

for (const themeId of themeIds) {
  const sourceDirectory = join(presetsSource, themeId);
  const themePath = join(sourceDirectory, "theme.json");
  const theme = JSON.parse(readFileSync(themePath, "utf8"));
  if (theme.id !== themeId || typeof theme.image !== "string" || !theme.image) {
    throw new Error(`Invalid metadata for ${themeId}`);
  }
  if (theme.image.includes("/") || theme.image.includes("\\")) {
    throw new Error(`Theme image must be a direct child for ${themeId}`);
  }
  const outputDirectory = join(outputRoot, "presets", themeId);
  mkdirSync(outputDirectory, { recursive: true });
  for (const fileName of ["theme.json", theme.image]) {
    const source = join(sourceDirectory, fileName);
    const destination = join(outputDirectory, fileName);
    copyFileSync(source, destination);
    utimesSync(destination, reproducibleTimestamp, reproducibleTimestamp);
    fileCount += 1;
  }
}

console.log(`Prepared ${themeIds.length} Dream Skin themes (${fileCount} files).`);
