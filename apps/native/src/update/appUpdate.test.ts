import { describe, expect, it } from 'vitest';
import { versionFromReleaseMetadata } from './version';

describe('versionFromReleaseMetadata', () => {
  it('falls back to the release name when GitHub returns an untagged tag', () => {
    expect(versionFromReleaseMetadata([
      'untagged-1a7305ccf75850d1b685',
      'Codex Switch v1.2.31',
      'CodexSwitch-android-v1.2.31.apk',
    ])).toBe('1.2.31');
  });

  it('prefers a valid tag over less authoritative metadata', () => {
    expect(versionFromReleaseMetadata([
      'v1.2.32-beta.0',
      'Codex Switch v1.2.31',
    ])).toBe('1.2.32-beta.0');
  });

  it('returns null when release metadata contains no semver version', () => {
    expect(versionFromReleaseMetadata([
      'untagged-1a7305ccf75850d1b685',
      'Codex Switch nightly build',
    ])).toBeNull();
  });
});
