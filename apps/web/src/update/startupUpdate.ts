import { version } from '../../../../package.json';
import type { StartupRelease, StartupUpdateOptions } from '../../../../shared/app-update/useStartupUpdate';
import { compareAppVersions, normalizedVersion, parseVersion } from '../../../../shared/app-update/version';

const IGNORED_VERSION_KEY = 'codex-switch.web.ignored-update-version.v1';
const CHECK_TIMEOUT_MS = 10_000;

export const startupUpdateOptions: StartupUpdateOptions<StartupRelease> = {
  async check() {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
      cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('version' in payload)) return null;
    const latest = payload.version;
    if (typeof latest !== 'string' || !parseVersion(latest)) return null;
    return compareAppVersions(latest, version) > 0 ? { version: normalizedVersion(latest) } : null;
  },
  readIgnoredVersion: async () => localStorage.getItem(IGNORED_VERSION_KEY),
  writeIgnoredVersion: async (ignored) => localStorage.setItem(IGNORED_VERSION_KEY, ignored),
};

export function reloadForUpdate() {
  // A unique URL also bypasses a cached HTML document while preserving the current route.
  const url = new URL(window.location.href);
  url.searchParams.set('_update', String(Date.now()));
  window.location.replace(url.href);
}
