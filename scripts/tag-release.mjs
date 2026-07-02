import { spawnSync } from "node:child_process";

const tag = process.argv[2];

if (!tag) {
  console.error("Usage: npm run release -- v0.1.0");
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`Invalid release tag "${tag}". Use a semver tag like v0.1.0.`);
  process.exit(1);
}

const result = spawnSync("git", ["tag", "-a", tag, "-m", `Release ${tag}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
