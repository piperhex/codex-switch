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

function comparePrerelease(left: string[], right: string[]) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function compareAppVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return normalizedVersion(left).localeCompare(normalizedVersion(right));

  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    if (parsedLeft.core[index] === parsedRight.core[index]) continue;
    return parsedLeft.core[index] > parsedRight.core[index] ? 1 : -1;
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
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
