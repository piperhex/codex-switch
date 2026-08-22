const RELEASE_VERSION_PATTERN =
  /(?:^|[^0-9A-Za-z])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;

export function normalizedVersion(value: string) {
  return value.trim().replace(/^v/i, '').split('+', 1)[0];
}

export function parseVersion(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalizedVersion(value));
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
    prerelease: match[4]?.split('.') ?? [],
  };
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

/**
 * Finds a semver version in release metadata. GitHub can expose releases with
 * an automatically generated `untagged-*` tag, while the release name and
 * attached asset names still contain the actual application version.
 */
export function versionFromReleaseMetadata(values: readonly unknown[]) {
  for (const value of values) {
    const text = textValue(value).trim();
    if (!text) continue;

    const directVersion = normalizedVersion(text);
    if (parseVersion(directVersion)) return directVersion;

    const match = RELEASE_VERSION_PATTERN.exec(text);
    if (match && parseVersion(match[1])) return match[1];
  }
  return null;
}
