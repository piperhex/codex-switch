import assert from "node:assert/strict";
import test from "node:test";

import { createUpdaterManifest } from "./generate-updater-manifest.mjs";

const suffixes = [
  "_macos-x64.app.tar.gz",
  "_macos-aarch64.app.tar.gz",
  "_linux-amd64.AppImage",
  "_linux-amd64.deb",
  "_windows-x64-setup.exe",
  "_windows-x64.msi",
  "_windows-arm64-setup.exe",
  "_windows-arm64.msi",
];

function fixture() {
  const assets = [];
  const signatures = new Map();
  let id = 100;
  for (const suffix of suffixes) {
    const assetName = `Codex.Switch_1.2.3${suffix}`;
    const asset = {
      id: id++,
      name: assetName,
      state: "uploaded",
      updated_at: "2026-08-12T12:47:28Z",
      url: `https://api.github.test/assets/${assetName}`,
    };
    const signatureAsset = {
      id: id++,
      name: `${asset.name}.sig`,
      state: "uploaded",
      updated_at: "2026-08-12T12:47:29Z",
      url: `https://api.github.test/assets/${id}`,
    };
    assets.push(asset, signatureAsset);
    signatures.set(signatureAsset.id, `signature:${suffix}`);
  }
  return {
    release: { body: "Release notes", assets },
    signatures,
  };
}

test("creates one complete manifest after every platform is available", () => {
  const { release, signatures } = fixture();
  const manifest = createUpdaterManifest({
    tagName: "v1.2.3",
    release,
    signatures,
  });

  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.notes, "Release notes");
  assert.equal(Object.keys(manifest.platforms).length, 13);
  assert.match(
    manifest.platforms["windows-x86_64"].url,
    /_windows-x64-setup\.exe$/,
  );
  assert.deepEqual(
    manifest.platforms["windows-x86_64"],
    manifest.platforms["windows-x86_64-nsis"],
  );
  assert.match(
    manifest.platforms["windows-aarch64-msi"].url,
    /_windows-arm64\.msi$/,
  );
});

test("refuses to publish a manifest when a required architecture is missing", () => {
  const { release, signatures } = fixture();
  release.assets = release.assets.filter(
    (asset) => !asset.name.includes("_windows-x64-setup.exe"),
  );

  assert.throws(
    () => createUpdaterManifest({ tagName: "v1.2.3", release, signatures }),
    /_windows-x64-setup\.exe/,
  );
});
