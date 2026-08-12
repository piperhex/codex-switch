import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UPDATE_ARTIFACTS = [
  {
    suffix: "_macos-x64.app.tar.gz",
    platforms: ["darwin-x86_64", "darwin-x86_64-app"],
  },
  {
    suffix: "_macos-aarch64.app.tar.gz",
    platforms: ["darwin-aarch64", "darwin-aarch64-app"],
  },
  {
    suffix: "_linux-amd64.AppImage",
    platforms: ["linux-x86_64", "linux-x86_64-appimage"],
  },
  {
    suffix: "_linux-amd64.deb",
    platforms: ["linux-x86_64-deb"],
  },
  {
    suffix: "_windows-x64-setup.exe",
    platforms: ["windows-x86_64", "windows-x86_64-nsis"],
  },
  {
    suffix: "_windows-x64.msi",
    platforms: ["windows-x86_64-msi"],
  },
  {
    suffix: "_windows-arm64-setup.exe",
    platforms: ["windows-aarch64", "windows-aarch64-nsis"],
  },
  {
    suffix: "_windows-arm64.msi",
    platforms: ["windows-aarch64-msi"],
  },
];

export function createUpdaterManifest({
  tagName,
  release,
  signatures,
}) {
  const version = normalizeVersion(tagName);
  const platforms = {};
  const updateAssets = [];

  for (const definition of UPDATE_ARTIFACTS) {
    const asset = findUniqueAsset(release.assets, definition.suffix);
    const signatureAsset = findUniqueAsset(release.assets, `${definition.suffix}.sig`);
    const signature = signatures.get(signatureAsset.id)?.trim();
    if (!signature) {
      throw new Error(`Signature content is missing for ${signatureAsset.name}.`);
    }

    const update = {
      signature,
      url: asset.url,
    };
    for (const platform of definition.platforms) {
      platforms[platform] = update;
    }
    updateAssets.push(asset);
  }

  return {
    version,
    notes: release.body ?? "",
    pub_date: newestAssetTimestamp(updateAssets),
    platforms,
  };
}

function normalizeVersion(tagName) {
  const version = tagName?.trim().replace(/^v/i, "");
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Release tag is not a supported semantic version: ${tagName ?? ""}`);
  }
  return version;
}

function findUniqueAsset(assets, suffix) {
  const matches = assets.filter(
    (asset) => asset.state === "uploaded" && asset.name.endsWith(suffix),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one uploaded release asset ending in ${suffix}, found ${matches.length}.`,
    );
  }
  return matches[0];
}

function newestAssetTimestamp(assets) {
  const timestamps = assets.map((asset) => Date.parse(asset.updated_at));
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    throw new Error("One or more updater assets have an invalid updated_at timestamp.");
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

async function main() {
  const token = requiredEnvironmentVariable("GITHUB_TOKEN");
  const repository = requiredEnvironmentVariable("GITHUB_REPOSITORY");
  const releaseId = requiredEnvironmentVariable("RELEASE_ID");
  const tagName = requiredEnvironmentVariable("TAG_NAME");
  const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const outputPath = resolve(process.env.UPDATER_MANIFEST_PATH || "latest.json");
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPOSITORY must use the owner/repository format: ${repository}`);
  }

  const release = await requestJson(
    `${apiUrl}/repos/${owner}/${repo}/releases/${releaseId}`,
    token,
  );
  if (release.tag_name !== tagName) {
    throw new Error(
      `Release ${releaseId} uses tag ${release.tag_name}, expected ${tagName}.`,
    );
  }

  const signatureAssets = release.assets.filter((asset) =>
    UPDATE_ARTIFACTS.some(({ suffix }) => asset.name.endsWith(`${suffix}.sig`)),
  );
  const signatures = new Map(
    await Promise.all(
      signatureAssets.map(async (asset) => [
        asset.id,
        await requestText(asset.url, token, "application/octet-stream"),
      ]),
    ),
  );
  const manifest = createUpdaterManifest({ tagName, release, signatures });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    `Generated updater manifest for ${manifest.version} with ${Object.keys(manifest.platforms).length} platform entries.`,
  );
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function requestJson(url, token) {
  const response = await request(url, token, "application/vnd.github+json");
  return response.json();
}

async function requestText(url, token, accept) {
  const response = await request(url, token, accept);
  return response.text();
}

async function request(url, token, accept) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "User-Agent": "codex-switch-release",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub request failed with HTTP ${response.status}: ${body}`);
  }
  return response;
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((error) => {
    console.error(`Updater manifest generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
